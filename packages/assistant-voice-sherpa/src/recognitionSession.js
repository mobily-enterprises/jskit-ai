import {
  VOICE_INPUT_SAMPLE_RATE,
  normalizeRecognizedText,
  pcm16LeToFloat32
} from "@jskit-ai/assistant-voice/shared/protocol";

/** A listener that does not follow the recognized words ignores them. */
function ignoreRecognizedText() {}

// Digital silence, exact zeros (a muted microphone, finish()'s lookahead), is outside what the model learned from: on
// ten seconds of it the default pack's recognizer heard "And" and "I am". As Kaldi's dither does, every sample a session
// feeds the recognizer gets noise of at most one 16-bit step, from a fixed sequence, so the same input gives the same
// words.
const DITHER_STEP = 1 / 32768;

function createDither() {
  let state = 0x9e3779b9;
  return samples => {
    for (let index = 0; index < samples.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      samples[index] += ((state >>> 0) / 0xffffffff * 2 - 1) * DITHER_STEP;
    }
    return samples;
  };
}

function decodeAvailable(recognizer, stream, vocabulary) {
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }
  return normalizeRecognizedText(recognizer.getResult(stream)?.text, vocabulary);
}

/**
 * One recording's recognition on a native recognizer. A recognition worker runs
 * these; each call is synchronous native work.
 * @param {any} recognizer A sherpa-onnx OnlineRecognizer.
 * @param {object} [options]
 * @param {Record<string, string>} [options.vocabulary] Recognized phrases and their spellings.
 * @param {number} [options.minimumRms] The input level that starts an utterance; zero keeps all input.
 * @param {number} [options.tailPaddingSeconds] Silence fed at the end, the model's lookahead.
 * @param {(text: string) => void} [options.onPartial] Called with the words so far whenever they change.
 * @param {(text: string) => void} [options.onEndpoint] Called when a continuous recording's speaker pauses after words.
 * @param {boolean} [options.continuous]
 */
function createRecognitionSession(recognizer, {
  vocabulary = {},
  minimumRms = 0,
  tailPaddingSeconds = 0.75,
  onPartial = ignoreRecognizedText,
  onEndpoint = ignoreRecognizedText,
  continuous = false
} = {}) {
  const stream = recognizer.createStream();
  const dither = createDither();
  let acceptedSamples = 0;
  let closed = false;
  let latestText = "";
  let endpointText = "";

  function acceptPcm(frame) {
    if (closed) {
      return latestText;
    }
    const samples = pcm16LeToFloat32(frame);
    // An explicit RMS floor gates onset only; after onset, retain every frame
    // for pauses and native endpoints. The default retains all input.
    if (minimumRms > 0 && !acceptedSamples) {
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      if (!samples.length || Math.sqrt(energy / samples.length) < minimumRms) return "";
    }
    acceptedSamples += samples.length;
    stream.acceptWaveform({
      sampleRate: VOICE_INPUT_SAMPLE_RATE,
      samples: dither(samples)
    });
    const text = decodeAvailable(recognizer, stream, vocabulary);
    if (text && text !== latestText) {
      latestText = text;
      endpointText = "";
      onPartial(text);
    }
    if (continuous && recognizer.isEndpoint(stream)) {
      if (!latestText) reset();
      else if (endpointText !== latestText) { endpointText = latestText; onEndpoint(latestText); }
    }
    return latestText;
  }

  function reset() {
    const text = latestText;
    recognizer.reset(stream);
    acceptedSamples = 0;
    latestText = "";
    endpointText = "";
    return text;
  }

  function finish() {
    if (closed) {
      return latestText;
    }
    closed = true;
    if (minimumRms > 0 && !acceptedSamples) return "";
    stream.acceptWaveform({
      sampleRate: VOICE_INPUT_SAMPLE_RATE,
      // Supply the model's lookahead when push-to-talk ends on the final word.
      samples: dither(new Float32Array(Math.floor(VOICE_INPUT_SAMPLE_RATE * tailPaddingSeconds)))
    });
    stream.inputFinished();
    const finalText = decodeAvailable(recognizer, stream, vocabulary);
    if (finalText) {
      latestText = finalText;
    }
    return latestText;
  }

  function isEndpoint() {
    return !closed && recognizer.isEndpoint(stream);
  }

  function cancel() {
    closed = true;
  }

  return Object.freeze({
    acceptPcm,
    reset,
    isEndpoint,
    cancel,
    finish,
    get acceptedSamples() {
      return acceptedSamples;
    }
  });
}

/** Decodes a second of silence so the first recording does not pay for the model's start. */
function warmRecognizer(recognizer) {
  const stream = recognizer.createStream();
  stream.acceptWaveform({ sampleRate: VOICE_INPUT_SAMPLE_RATE, samples: new Float32Array(VOICE_INPUT_SAMPLE_RATE) });
  stream.inputFinished();
  decodeAvailable(recognizer, stream, {});
}

export {
  createRecognitionSession,
  warmRecognizer
};
