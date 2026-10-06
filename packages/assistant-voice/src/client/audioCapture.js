const CAPTURE_WORKLET_NAME = "jskit-voice-capture";
const CAPTURE_FLUSH_TIMEOUT_MS = 500;
const CAPTURE_FRAME_SAMPLES = 1_024;
const CAPTURE_WORKLET_SOURCE = `
class AssistantVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.accepting = true;
    this.muted = false;
    this.frames = [];
    this.length = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type === "mute") {
        this.muted = event.data.muted;
        this.frames = [];
        this.length = 0;
        return;
      }
      if (event.data?.type !== "flush") return;
      this.accepting = false;
      this.emit();
      this.port.postMessage({ type: "flushed" });
    };
  }

  emit() {
    if (!this.length) return;
    const samples = new Float32Array(this.length);
    let offset = 0;
    for (const frame of this.frames) {
      samples.set(frame, offset);
      offset += frame.length;
    }
    this.frames = [];
    this.length = 0;
    this.port.postMessage(samples, [samples.buffer]);
  }

  process(inputs) {
    if (!this.accepting || this.muted) return true;
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    this.frames.push(Float32Array.from(input));
    this.length += input.length;
    if (this.length >= ${CAPTURE_FRAME_SAMPLES}) this.emit();
    return true;
  }
}
registerProcessor("${CAPTURE_WORKLET_NAME}", AssistantVoiceCapture);
`;

function float32ToPcm16ArrayBuffer(samples) {
  const output = new ArrayBuffer(samples.length * 2);
  const view = new DataView(output);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
    view.setInt16(index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return output;
}

async function createMicrophoneCapture({ onLevel, onPcm, targetSampleRate = 16_000 } = {}) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("This browser does not support microphone audio processing.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: { ideal: targetSampleRate }
    },
    video: false
  });
  const stopTracks = () => {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };
  let context = null;
  try {
    context = new AudioContextCtor({
      latencyHint: "interactive",
      sampleRate: targetSampleRate
    });
    await context.resume();
    if (Number(context.sampleRate) !== targetSampleRate) {
      throw new Error(`This browser could not capture ${targetSampleRate} Hz microphone audio.`);
    }
    const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], {
      type: "text/javascript"
    }));
    try {
      await context.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, CAPTURE_WORKLET_NAME, {
      channelCount: 1,
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    const silence = context.createGain();
    silence.gain.value = 0;
    let finishFlush = null;
    let muted = false;
    capture.port.onmessage = (event) => {
      if (event.data?.type === "flushed") {
        finishFlush?.();
        return;
      }
      if (muted) return;
      const samples = event.data instanceof Float32Array
        ? event.data
        : new Float32Array(event.data);
      let squaredTotal = 0;
      for (const sample of samples) {
        squaredTotal += sample * sample;
      }
      onLevel?.(samples.length
        ? Math.min(1, Math.sqrt(squaredTotal / samples.length) * 7)
        : 0);
      onPcm?.(float32ToPcm16ArrayBuffer(samples));
    };
    source.connect(capture);
    capture.connect(silence);
    silence.connect(context.destination);

    let closePromise = null;
    const flush = () => new Promise((resolve) => {
      let finished = false;
      const timeout = globalThis.setTimeout(() => {
        if (!finished) {
          finished = true;
          finishFlush = null;
          resolve();
        }
      }, CAPTURE_FLUSH_TIMEOUT_MS);
      finishFlush = () => {
        if (finished) return;
        finished = true;
        globalThis.clearTimeout(timeout);
        finishFlush = null;
        resolve();
      };
      try {
        capture.port.postMessage({ type: "flush" });
      } catch {
        finishFlush();
      }
    });
    return Object.freeze({
      setMuted(value) {
        if (muted === Boolean(value)) return;
        muted = Boolean(value);
        for (const track of stream.getTracks()) track.enabled = !muted;
        capture.port.postMessage({ type: "mute", muted });
        if (muted) onLevel?.(0);
      },
      close() {
        if (!closePromise) {
          closePromise = (async () => {
            try {
              await flush();
            } finally {
              onLevel?.(0);
              capture.port.onmessage = null;
              try {
                source.disconnect();
                capture.disconnect();
                silence.disconnect();
              } finally {
                stopTracks();
                await context.close();
              }
            }
          })();
        }
        return closePromise;
      }
    });
  } catch (error) {
    stopTracks();
    if (context && context.state !== "closed") {
      await context.close().catch(() => null);
    }
    throw error;
  }
}

export {
  createMicrophoneCapture,
  float32ToPcm16ArrayBuffer
};
