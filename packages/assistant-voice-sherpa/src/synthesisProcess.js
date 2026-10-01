import { fork } from "node:child_process";

// Sherpa's Node API has no explicit model disposal. Process exit releases both
// the model and ONNX's native arenas before another voice is loaded.
export async function createSynthesisProcess(configuration, {
  workerUrl = new URL("./synthesisWorker.js", import.meta.url)
} = {}) {
  const child = fork(workerUrl, [], { execArgv: [], serialization: "advanced", stdio: ["ignore", "ignore", "inherit", "ipc"] });
  let pending = null;
  let stopped = false;
  const exited = new Promise(resolve => child.once("close", resolve));

  function settle(error, value) {
    const operation = pending;
    if (!operation) return;
    pending = null;
    clearTimeout(operation.timer);
    if (error) operation.reject(error);
    else operation.resolve(value);
  }

  child.on("error", error => { stopped = true; settle(error); });
  child.on("exit", (code, signal) => {
    stopped = true;
    settle(new Error(`Speech worker exited (${signal || code}).`));
  });
  child.on("message", message => {
    if (!pending) return;
    if (message.type === "audio") {
      try { pending.onAudio?.(message.pcm); } catch (error) { settle(error); }
    } else if (message.type === "error") settle(new Error(message.message));
    else if (message.type === "result") settle(null, message.result);
  });

  async function close() {
    stopped = true;
    settle(new Error("Speech worker closed."));
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }

  function request(type, fields, onAudio) {
    if (stopped) return Promise.reject(new Error("Speech worker is unavailable."));
    if (pending) return Promise.reject(new Error("Speech synthesis is already running."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { settle(new Error("Speech worker timed out.")); void close(); }, 60_000);
      pending = { resolve, reject, onAudio, timer };
      child.send({ type, ...fields }, error => { if (error) settle(error); });
    });
  }

  try {
    const metadata = await request("load", { configuration });
    return Object.freeze({
      ...metadata,
      get running() { return !stopped; },
      close,
      async synthesize(text, { speakerId, onAudio = () => null, signal } = {}) {
        let samples = 0;
        const abort = () => { void close(); };
        if (signal?.aborted) return { cancelled: true, sampleRate: metadata.sampleRate, samples };
        signal?.addEventListener("abort", abort, { once: true });
        try {
          await request("synthesize", { text, speakerId }, frame => {
            if (signal?.aborted) return;
            samples += frame.byteLength / 2;
            onAudio(frame);
          });
        } catch (error) {
          await close();
          if (!signal?.aborted) throw error;
        } finally { signal?.removeEventListener("abort", abort); }
        return { cancelled: Boolean(signal?.aborted), sampleRate: metadata.sampleRate, samples };
      }
    });
  } catch (error) {
    await close();
    throw error;
  }
}
