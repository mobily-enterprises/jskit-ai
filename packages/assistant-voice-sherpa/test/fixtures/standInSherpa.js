// A stand-in for sherpa-onnx-node's recognizer, with no model: each decode holds
// its thread for the configured time, as native decoding does, without using the
// CPU, so tests can see whether decodes overlap on a busy test host.
const hold = new Int32Array(new SharedArrayBuffer(4));

function holdThread(milliseconds) {
  if (milliseconds > 0) Atomics.wait(hold, 0, 0, milliseconds);
}

export class OnlineRecognizer {
  constructor(config = {}) {
    this.config = config;
    this.decodeMs = Number(config.standInDecodeMs) || 0;
    if (config.standInFailLoad) throw new Error("Stand-in recognizer refused its model.");
  }

  createStream() {
    return {
      samples: 0,
      decoded: 0,
      finished: false,
      acceptWaveform({ samples }) { this.samples += samples.length; },
      inputFinished() { this.finished = true; }
    };
  }

  isReady(stream) { return stream.decoded < stream.samples; }

  decode(stream) {
    holdThread(this.decodeMs);
    if (this.config.standInCrashOnDecode) process.exit(23);
    stream.decoded = stream.samples;
  }

  getResult(stream) { return { text: stream.decoded ? "HELLO WORLD" : "" }; }

  isEndpoint() { return false; }

  reset(stream) {
    stream.samples = 0;
    stream.decoded = 0;
  }
}

export const version = "stand-in-1";
export const gitSha1 = "stand-in";
export const onnxruntimeVersion = "stand-in";
