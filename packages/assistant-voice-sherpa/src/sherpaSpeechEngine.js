import path from "node:path";
import { createRequire } from "node:module";
import { createSynthesisProcess } from "./synthesisProcess.js";

import {
  VOICE_INPUT_SAMPLE_RATE,
  normalizeRecognizedText,
  pcm16LeToFloat32
} from "@jskit-ai/assistant-voice/shared/protocol";

const require = createRequire(import.meta.url);

function positiveThreadCount(value, fallback = 1) {
  const count = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(count) && count > 0 && count <= 8 ? count : fallback;
}

function positiveActivePathCount(value, fallback = 16) {
  const count = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(count) && count > 0 && count <= 64 ? count : fallback;
}

function runtimeValue(runtime, key) {
  const value = runtime?.[key];
  return String(typeof value === "function" ? value.call(runtime) : value || "");
}

async function createSherpaSpeechEngine({
  modelsRoot = "",
  configuration = {},
  recognizerActivePaths = 16,
  recognizerThreads = 1,
  sherpa = null,
  createSynthesizer = createSynthesisProcess,
  synthesizerThreads = 1
} = {}) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) throw new TypeError("Speech configuration must be an object.");
  const recognitionVocabulary = configuration.recognitionVocabulary ?? {};
  if (!recognitionVocabulary || typeof recognitionVocabulary !== "object" || Array.isArray(recognitionVocabulary) ||
      Object.entries(recognitionVocabulary).some(([phrase, spelling]) => !phrase.trim() || typeof spelling !== "string" || !spelling.trim())) {
    throw new TypeError("Recognition vocabulary must map nonempty phrases to their written spellings.");
  }
  const outputSampleRate = configuration.outputSampleRate;
  if (outputSampleRate !== undefined && (!Number.isInteger(outputSampleRate) || outputSampleRate < 8000 || outputSampleRate > 48000)) {
    throw new TypeError("Output sample rate must be an integer between 8000 and 48000 Hz.");
  }
  const runtime = sherpa || require("sherpa-onnx-node");
  const root = path.resolve(String(modelsRoot || ""));
  function modelPaths(value) {
    if (typeof value === "string") return value.replaceAll("${MODELS_ROOT}", root);
    if (Array.isArray(value)) return value.map(modelPaths);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, modelPaths(entry)]));
    return value;
  }
  configuration = modelPaths(configuration);
  const tailPaddingSeconds = configuration.recognizerTailPaddingSeconds ?? 1;
  if (!Number.isFinite(tailPaddingSeconds) || tailPaddingSeconds < 0 || tailPaddingSeconds > 3) {
    throw new TypeError("Recognizer tail padding must be between zero and three seconds.");
  }
  const minimumRms = configuration.recognizerMinimumRms ?? 0.001;
  if (!Number.isFinite(minimumRms) || minimumRms <= 0 || minimumRms > 0.1) {
    throw new TypeError("Recognizer minimum RMS must be greater than zero and at most 0.1.");
  }
  const recognizer = new runtime.OnlineRecognizer(configuration.recognizer || {
    decodingMethod: "modified_beam_search",
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 0.65,
    rule3MinUtteranceLength: 55,
    featConfig: {
      featureDim: 80,
      sampleRate: VOICE_INPUT_SAMPLE_RATE
    },
    hotwordsFile: path.join(root, "stt", "hotwords.txt"),
    hotwordsScore: 1.5,
    maxActivePaths: positiveActivePathCount(recognizerActivePaths),
    modelConfig: {
      bpeVocab: path.join(root, "stt", "bpe.vocab"),
      debug: 0,
      modelingUnit: "bpe",
      numThreads: positiveThreadCount(recognizerThreads),
      provider: "cpu",
      tokens: path.join(root, "stt", "tokens.txt"),
      transducer: {
        decoder: path.join(root, "stt", "decoder.int8.onnx"),
        encoder: path.join(root, "stt", "encoder.int8.onnx"),
        joiner: path.join(root, "stt", "joiner.int8.onnx")
      }
    }
  });
  const defaultSynthesizer = configuration.synthesizer || {
    maxNumSentences: 1,
    model: {
      numThreads: positiveThreadCount(synthesizerThreads),
      provider: "cpu",
      vits: {
        dataDir: path.join(root, "tts", "espeak-ng-data"),
        model: path.join(root, "tts", "model.onnx"),
        tokens: path.join(root, "tts", "tokens.txt")
      }
    }
  };

  const voices = configuration.voices || (configuration.synthesizer || configuration.synthesizers
    ? [{ id: "default", label: "Default voice", speakerId: 0 }]
    : [{ id: "cori", label: "Cori · female · British English · Piper", language: "en-GB", speakerId: 0 }]);
  if (!Array.isArray(voices) || !voices.length || voices.length > 128 || new Set(voices.map(voice => voice?.id)).size !== voices.length ||
      voices.some(voice => !voice || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(voice.id) || typeof voice.label !== "string" || !voice.label.trim() || voice.label.length > 100 ||
        !Number.isSafeInteger(voice.speakerId) || voice.speakerId < 0)) {
    throw new TypeError("Configure unique voice IDs, names and valid model speaker IDs.");
  }
  if (voices.some(voice => voice.speed !== undefined && (!Number.isFinite(voice.speed) || voice.speed < 0.5 || voice.speed > 2))) {
    throw new TypeError("Voice speed must be a number between 0.5 and 2.");
  }
  const defaultVoice = configuration.defaultVoice || voices[0].id;
  if (!voices.some(voice => voice.id === defaultVoice)) throw new TypeError("The default voice must be in the configured voice list.");
  if (configuration.synthesizer && configuration.synthesizers) throw new TypeError("Configure synthesizer or synthesizers, not both.");
  const modelConfigurations = configuration.synthesizers || { default: defaultSynthesizer };
  if (!modelConfigurations || typeof modelConfigurations !== "object" || Array.isArray(modelConfigurations) ||
      voices.some(voice => !Object.hasOwn(modelConfigurations, voice.modelId || "default"))) {
    throw new TypeError("Each voice must select a configured synthesizer model.");
  }
  let synthesizer = null;
  let selectedModel = "";
  let sampleRate;
  let busy = false;
  let closed = false;
  let replacement = null;
  async function selectModel(modelId, signal = null) {
    if (closed) throw new Error("Speech engine is closed.");
    signal?.throwIfAborted();
    if (selectedModel === modelId && synthesizer?.running) return synthesizer;
    await synthesizer?.close();
    synthesizer = null;
    if (closed) throw new Error("Speech engine is closed.");
    signal?.throwIfAborted();
    replacement = createSynthesizer(modelConfigurations[modelId], { outputSampleRate, ...(signal ? { signal } : {}) });
    let model;
    try {
      model = await replacement;
      signal?.throwIfAborted();
      if (closed) throw new Error("Speech engine is closed.");
      if (voices.some(voice => (voice.modelId || "default") === modelId && voice.speakerId >= model.numSpeakers)) {
        throw new TypeError("Configure unique voice IDs, names and valid model speaker IDs.");
      }
      sampleRate ??= Number(model.sampleRate);
      if (Number(model.sampleRate) !== sampleRate) throw new TypeError("All voice models must use the same output sample rate.");
    } catch (error) { await model?.close(); throw error; }
    finally { replacement = null; }
    selectedModel = modelId;
    synthesizer = model;
    return model;
  }
  // Validate every configured voice without retaining its native allocations.
  // Finish with the default so ordinary startup needs no subsequent model swap.
  const defaultModel = voices.find(voice => voice.id === defaultVoice).modelId || "default";
  const modelIds = new Set(voices.map(voice => voice.modelId || "default"));
  modelIds.delete(defaultModel);
  for (const modelId of [...modelIds, defaultModel]) await selectModel(modelId);

  function decodeAvailable(stream) {
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    return normalizeRecognizedText(recognizer.getResult(stream)?.text, recognitionVocabulary);
  }

  function createListeningSession({ onPartial = () => null, onEndpoint = () => null, continuous = false } = {}) {
    const stream = recognizer.createStream();
    let acceptedSamples = 0;
    let closed = false;
    let latestText = "";
    let endpointText = "";

    function acceptPcm(frame) {
      if (closed) {
        return latestText;
      }
      const samples = pcm16LeToFloat32(frame);
      // This recognizer can invent words from silent input. Wait for an audible
      // onset; once it starts, keep every frame for pauses and native endpoints.
      if (!acceptedSamples) {
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        if (!samples.length || Math.sqrt(energy / samples.length) < minimumRms) return "";
      }
      acceptedSamples += samples.length;
      stream.acceptWaveform({
        sampleRate: VOICE_INPUT_SAMPLE_RATE,
        samples
      });
      const text = decodeAvailable(stream);
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
      if (!acceptedSamples) return "";
      stream.acceptWaveform({
        sampleRate: VOICE_INPUT_SAMPLE_RATE,
        // Supply the model's lookahead when push-to-talk ends on the final word.
        samples: new Float32Array(Math.floor(VOICE_INPUT_SAMPLE_RATE * tailPaddingSeconds))
      });
      stream.inputFinished();
      const finalText = decodeAvailable(stream);
      if (finalText) {
        latestText = finalText;
      }
      return latestText;
    }

    return Object.freeze({
      acceptPcm,
      reset,
      isEndpoint: () => !closed && recognizer.isEndpoint(stream),
      cancel() {
        closed = true;
      },
      finish,
      get acceptedSamples() {
        return acceptedSamples;
      }
    });
  }

  async function synthesize(text, { onAudio = () => null, signal = null, voiceId = defaultVoice } = {}) {
    const voice = voices.find(voice => voice.id === voiceId);
    if (!voice) throw new Error("The selected voice is not available.");
    if (closed) throw new Error("Speech engine is closed.");
    if (busy) throw new Error("Speech synthesis is already running.");
    if (signal?.aborted) return { cancelled: true, sampleRate, samples: 0 };
    busy = true;
    try {
      let model;
      try {
        model = await selectModel(voice.modelId || "default", signal);
      } catch (error) {
        if (!signal?.aborted) throw error;
        return { cancelled: true, sampleRate, samples: 0 };
      }
      return await model.synthesize(String(text || ""), { speakerId: voice.speakerId, speed: voice.speed ?? 1, onAudio, signal });
    } finally { busy = false; }
  }

  async function warmup() {
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: VOICE_INPUT_SAMPLE_RATE, samples: new Float32Array(VOICE_INPUT_SAMPLE_RATE) });
    stream.inputFinished();
    decodeAvailable(stream);
    await synthesize("Ready.");
    return true;
  }

  return Object.freeze({
    createListeningSession,
    async close() {
      closed = true;
      const loading = replacement;
      await synthesizer?.close();
      if (loading) await (await loading.catch(() => null))?.close();
    },
    defaultVoice,
    voices: Object.freeze(voices.map(voice => Object.freeze({ ...voice }))),
    runtime: Object.freeze({
      gitSha1: runtimeValue(runtime, "gitSha1"),
      onnxruntimeVersion: runtimeValue(runtime, "onnxruntimeVersion"),
      version: runtimeValue(runtime, "version")
    }),
    sampleRate,
    synthesize,
    warmup
  });
}

export {
  createSherpaSpeechEngine,
  positiveActivePathCount,
  positiveThreadCount,
  runtimeValue
};
