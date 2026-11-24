import { createRequire } from "node:module";
import { createRecognitionSession, warmRecognizer } from "./recognitionSession.js";

// One recognition process: a native recognizer and the recordings the engine
// gives it. Native decoding is synchronous, so each process decodes one slice at
// a time and the engine runs several processes side by side.
const require = createRequire(import.meta.url);
let recognizer = null;
let sessionOptions = {};
const sessions = new Map();

function runtimeValue(runtime, key) {
  const value = runtime?.[key];
  return String(typeof value === "function" ? value.call(runtime) : value || "");
}

function session(id) {
  const entry = sessions.get(id);
  if (!entry) throw new Error("This recording is no longer open.");
  return entry;
}

function step(id, operation) {
  const entry = session(id);
  entry.events = [];
  const value = operation(entry.session);
  return { ...value, acceptedSamples: entry.session.acceptedSamples, events: entry.events };
}

const operations = {
  async load({ configuration, options, runtimeModule }) {
    const runtime = runtimeModule ? await import(runtimeModule) : require("sherpa-onnx-node");
    recognizer = new runtime.OnlineRecognizer(configuration);
    sessionOptions = options || {};
    return {
      gitSha1: runtimeValue(runtime, "gitSha1"),
      onnxruntimeVersion: runtimeValue(runtime, "onnxruntimeVersion"),
      version: runtimeValue(runtime, "version")
    };
  },
  warmup() {
    warmRecognizer(recognizer);
  },
  open({ id, continuous }) {
    const entry = { events: [], session: null };
    entry.session = createRecognitionSession(recognizer, {
      ...sessionOptions,
      continuous: continuous === true,
      onPartial: text => entry.events.push({ type: "partial", text }),
      onEndpoint: text => entry.events.push({ type: "endpoint", text })
    });
    sessions.set(id, entry);
  },
  accept: ({ id, pcm }) => step(id, current => ({ text: current.acceptPcm(pcm) })),
  reset: ({ id }) => step(id, current => ({ text: current.reset() })),
  isEndpoint: ({ id }) => step(id, current => ({ endpoint: current.isEndpoint() })),
  finish({ id }) {
    try {
      return step(id, current => ({ text: current.finish() }));
    } finally { sessions.delete(id); }
  },
  close({ id }) {
    sessions.delete(id);
  }
};

// A lost parent must not leave a native model resident in an orphan process.
process.once("disconnect", () => process.exit(0));
process.on("message", async message => {
  const operation = operations[message?.type];
  try {
    if (!operation) throw new Error(`Unknown recognition request ${message?.type}.`);
    const result = await operation(message);
    if (message.seq) process.send({ seq: message.seq, type: "result", result: result ?? {} });
  } catch (error) {
    if (message?.seq) process.send({ seq: message.seq, type: "error", message: String(error?.message || error) });
  }
});
