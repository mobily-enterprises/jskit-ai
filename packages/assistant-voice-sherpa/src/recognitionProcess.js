import { fork } from "node:child_process";

export const RECOGNITION_LOAD_TIMEOUT_MS = 60_000;
export const RECOGNITION_REQUEST_TIMEOUT_MS = 15_000;

/** A listener that does not follow the recognized words ignores them. */
function ignoreRecognizedText() {}

/**
 * A recognition worker process holding one native recognizer; the engine gives
 * it recordings. A request that takes longer than its watchdog ends the process
 * and fails every recording on it.
 * @param {object} configuration The native OnlineRecognizer configuration.
 * @param {object} [options]
 * @param {{ vocabulary?: Record<string, string>, minimumRms?: number, tailPaddingSeconds?: number }} [options.options] Each recording's settings.
 * @param {string} [options.runtimeModule] A module standing in for sherpa-onnx-node, for tests.
 * @param {URL} [options.workerUrl]
 */
export async function createRecognitionProcess(configuration, {
  options = {},
  runtimeModule = "",
  workerUrl = new URL("./recognitionWorker.js", import.meta.url)
} = {}) {
  const child = fork(workerUrl, [], { execArgv: [], serialization: "advanced", stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const pending = new Map();
  let sequence = 0;
  let recordings = 0;
  let stopped = false;
  const exited = new Promise(resolve => child.once("close", resolve));

  function failAll(error) {
    for (const operation of pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(error);
    }
    pending.clear();
  }

  child.on("error", error => { stopped = true; failAll(error); });
  child.on("exit", (code, signal) => {
    stopped = true;
    failAll(new Error(`Recognition worker exited (${signal || code}).`));
  });
  child.on("message", message => {
    const operation = pending.get(message?.seq);
    if (!operation) return;
    pending.delete(message.seq);
    clearTimeout(operation.timer);
    if (message.type === "error") operation.reject(new Error(message.message));
    else operation.resolve(message.result);
  });

  async function close() {
    stopped = true;
    failAll(new Error("Recognition worker closed."));
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }

  function request(type, fields = {}, timeoutMs = RECOGNITION_REQUEST_TIMEOUT_MS) {
    if (stopped) return Promise.reject(new Error("Recognition worker is unavailable."));
    const seq = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(seq);
        reject(new Error("Recognition worker timed out."));
        void close();
      }, timeoutMs);
      pending.set(seq, { resolve, reject, timer });
      child.send({ seq, type, ...fields }, error => {
        if (!error || !pending.has(seq)) return;
        pending.delete(seq);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function forget(type, fields) {
    if (!stopped) child.send({ type, ...fields }, () => null);
  }

  /** One recording on this process; its steps run in the order called. */
  function openRecording({ continuous = false, onPartial = ignoreRecognizedText, onEndpoint = ignoreRecognizedText } = {}) {
    const id = ++sequence;
    recordings += 1;
    const opened = request("open", { id, continuous });
    opened.catch(() => null);
    let closed = false;
    let acceptedSamples = 0;
    let latestText = "";

    function release() {
      if (closed) return;
      closed = true;
      recordings -= 1;
    }

    async function step(type, fields = {}) {
      await opened;
      const result = await request(type, { id, ...fields });
      acceptedSamples = result.acceptedSamples;
      if (!closed) {
        for (const event of result.events) (event.type === "endpoint" ? onEndpoint : onPartial)(event.text);
      }
      if (typeof result.text === "string") latestText = result.text;
      return result;
    }

    return Object.freeze({
      async acceptPcm(frame) {
        if (closed) return latestText;
        // A copy, so only this slice crosses to the worker.
        return (await step("accept", { pcm: Buffer.from(frame) })).text;
      },
      async finish() {
        if (closed) return latestText;
        try { return (await step("finish")).text; } finally { release(); }
      },
      async reset() {
        if (closed) return latestText;
        return (await step("reset")).text;
      },
      async isEndpoint() {
        if (closed) return false;
        return (await step("isEndpoint")).endpoint;
      },
      cancel() {
        if (closed) return;
        release();
        forget("close", { id });
      },
      get acceptedSamples() {
        return acceptedSamples;
      }
    });
  }

  function warmup() {
    return request("warmup", {}, RECOGNITION_LOAD_TIMEOUT_MS);
  }

  try {
    const runtime = await request("load", { configuration, options, runtimeModule: String(runtimeModule || "") }, RECOGNITION_LOAD_TIMEOUT_MS);
    return Object.freeze({
      close,
      openRecording,
      pid: child.pid,
      get recordings() { return recordings; },
      get running() { return !stopped; },
      runtime: Object.freeze(runtime),
      warmup
    });
  } catch (error) {
    await close();
    throw error;
  }
}
