import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createRecognitionProcess } from "./recognitionProcess.js";
import { createSynthesisProcess, SYNTHESIS_REQUEST_TIMEOUT_MS } from "./synthesisProcess.js";

import {
  VOICE_ID_PATTERN,
  VOICE_INPUT_SAMPLE_RATE,
  recognitionHotword,
  recognitionHotwords,
  recognitionSpellingCount,
  recognitionSpellings
} from "@jskit-ai/assistant-voice/shared/protocol";

const require = createRequire(import.meta.url);
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const MAXIMUM_WORKERS = 64;

function positiveThreadCount(value, fallback = 1) {
  const count = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(count) && count > 0 && count <= 8 ? count : fallback;
}

function positiveActivePathCount(value, fallback = 16) {
  const count = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(count) && count > 0 && count <= 64 ? count : fallback;
}

/** One worker per CPU the process may use, which a host can override. */
function defaultWorkerCount() {
  return Math.min(MAXIMUM_WORKERS, os.availableParallelism());
}

function workerCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAXIMUM_WORKERS) {
    throw new TypeError(`${name} must be a whole number from 1 to ${MAXIMUM_WORKERS}.`);
  }
  return value;
}

function installedVersion(packageName) {
  try {
    return String(require(`${packageName}/package.json`).version || "");
  } catch {
    return "";
  }
}

// JSKIT's hotwords from the prepared pack, kept as written, then the host's,
// each phrase once.
async function hotwordLines(baseFile, added) {
  const base = baseFile ? await readFile(baseFile, "utf8").catch(error => {
    if (error.code === "ENOENT") return "";
    throw error;
  }) : "";
  const prepared = base.split("\n").map(line => line.trim()).filter(Boolean)
    .map(line => ({ words: recognitionHotword(line)?.words ?? line, line }));
  const seen = new Set();
  const lines = [];
  for (const hotword of [...prepared, ...added]) {
    if (seen.has(hotword.words)) continue;
    seen.add(hotword.words);
    lines.push(hotword.line);
  }
  return lines;
}

async function recognitionModelId(root) {
  try {
    const sources = JSON.parse(await readFile(path.join(root, "sources.json"), "utf8"));
    return String(sources.models?.find(model => model?.kind === "stt")?.id || "custom");
  } catch {
    return "custom";
  }
}

// Closes the processes that started; a start that failed left none.
async function closeAll(resources) {
  await Promise.all(resources.filter(Boolean).map(resource => resource.close().catch(() => null)));
}

/**
 * The native Sherpa speech engine of a voice host: streaming recognition in a
 * pool of recognition processes, and synthesis in a pool of processes that each
 * keep one voice model loaded.
 * @param {object} [options]
 * @param {string} [options.modelsRoot]
 * @param {Record<string, any>} [options.configuration]
 * @param {string[]} [options.hotwords] The host's phrases, added to the prepared pack's hotwords.
 * @param {Record<string, string>} [options.spellings] The host's spellings, spoken phrase to written form,
 *   added to JSKIT's and the configuration's `recognitionVocabulary`; a host's wins on a clash.
 * @param {number} [options.recognitionWorkers] Recognition processes; default one per CPU.
 * @param {number} [options.synthesisWorkers] Synthesis processes; default one per CPU.
 * @param {number} [options.recognizerActivePaths]
 * @param {number} [options.recognizerThreads]
 * @param {typeof createRecognitionProcess} [options.createRecognizer]
 * @param {typeof createSynthesisProcess} [options.createSynthesizer]
 * @param {number} [options.synthesizerThreads]
 */
async function createSherpaSpeechEngine({
  modelsRoot = "",
  configuration = {},
  hotwords = [],
  spellings = {},
  recognitionWorkers = defaultWorkerCount(),
  synthesisWorkers = defaultWorkerCount(),
  recognizerActivePaths = 16,
  recognizerThreads = 1,
  createRecognizer = createRecognitionProcess,
  createSynthesizer = createSynthesisProcess,
  synthesizerThreads = 1
} = {}) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) throw new TypeError("Speech configuration must be an object.");
  workerCount(recognitionWorkers, "Recognition workers");
  workerCount(synthesisWorkers, "Synthesis workers");
  const configuredVocabulary = configuration.recognitionVocabulary ?? {};
  if (!configuredVocabulary || typeof configuredVocabulary !== "object" || Array.isArray(configuredVocabulary) ||
      Object.entries(configuredVocabulary).some(([phrase, spelling]) => !phrase.trim() || typeof spelling !== "string" || !spelling.trim())) {
    throw new TypeError("Recognition vocabulary must map nonempty phrases to their written spellings.");
  }
  const recognitionVocabulary = Object.freeze({
    ...Object.fromEntries(Object.entries(configuredVocabulary).map(([phrase, spelling]) => [phrase.trim().replace(/\s+/gu, " ").toLowerCase(), spelling])),
    ...recognitionSpellings(spellings)
  });
  const added = recognitionHotwords(hotwords).map(recognitionHotword);
  const outputSampleRate = configuration.outputSampleRate;
  if (outputSampleRate !== undefined && (!Number.isInteger(outputSampleRate) || outputSampleRate < 8000 || outputSampleRate > 48000)) {
    throw new TypeError("Output sample rate must be an integer between 8000 and 48000 Hz.");
  }
  const root = path.resolve(String(modelsRoot || ""));
  function modelPaths(value) {
    if (typeof value === "string") return value.replaceAll("${MODELS_ROOT}", root);
    if (Array.isArray(value)) return value.map(modelPaths);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, modelPaths(entry)]));
    return value;
  }
  configuration = modelPaths(configuration);
  const tailPaddingSeconds = configuration.recognizerTailPaddingSeconds ?? 0.45;
  if (!Number.isFinite(tailPaddingSeconds) || tailPaddingSeconds < 0 || tailPaddingSeconds > 3) {
    throw new TypeError("Recognizer tail padding must be between zero and three seconds.");
  }
  const minimumRms = configuration.recognizerMinimumRms ?? 0;
  if (!Number.isFinite(minimumRms) || minimumRms < 0 || minimumRms > 0.1) {
    throw new TypeError("Recognizer minimum RMS must be between zero and 0.1.");
  }
  const recognizerConfiguration = configuration.recognizer || {
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
  };
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
      voices.some(voice => !voice || !VOICE_ID_PATTERN.test(voice.id) || typeof voice.label !== "string" || !voice.label.trim() || voice.label.length > 100 ||
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

  let closed = false;
  let sampleRate;
  let hotwordsFolder = "";
  const recognitionSlots = [];
  const synthesisSlots = Array.from({ length: synthesisWorkers }, () => ({ model: null, modelId: "", busy: false, used: 0, loading: null }));
  const synthesisWaiters = [];
  let useClock = 0;

  const closedError = () => new Error("Speech engine is closed.");

  // A slot keeps one model; changing it closes the old process before the next loads.
  async function selectModel(slot, modelId, signal = null) {
    if (closed) throw closedError();
    signal?.throwIfAborted();
    if (slot.modelId === modelId && slot.model?.running) return slot.model;
    await slot.model?.close();
    slot.model = null;
    slot.modelId = "";
    if (closed) throw closedError();
    signal?.throwIfAborted();
    slot.loading = createSynthesizer(modelConfigurations[modelId], { outputSampleRate, ...(signal ? { signal } : {}) });
    let model;
    try {
      model = await slot.loading;
      signal?.throwIfAborted();
      if (closed) throw closedError();
      if (voices.some(voice => (voice.modelId || "default") === modelId && voice.speakerId >= model.numSpeakers)) {
        throw new TypeError("Configure unique voice IDs, names and valid model speaker IDs.");
      }
      sampleRate ??= Number(model.sampleRate);
      if (Number(model.sampleRate) !== sampleRate) throw new TypeError("All voice models must use the same output sample rate.");
    } catch (error) { await model?.close(); throw error; }
    finally { slot.loading = null; }
    slot.modelId = modelId;
    slot.model = model;
    return model;
  }

  // An idle slot that already has the model, else an empty one, else the one
  // used longest ago; with none idle, the request waits its turn.
  function idleSlotFor(modelId) {
    const idle = synthesisSlots.filter(slot => !slot.busy);
    return idle.find(slot => slot.modelId === modelId && slot.model?.running) ||
      idle.find(slot => !slot.model?.running) ||
      idle.sort((left, right) => left.used - right.used)[0];
  }

  function acquireSynthesisSlot(modelId, signal) {
    return new Promise((resolve, reject) => {
      const abandon = () => {
        const index = synthesisWaiters.indexOf(waiter);
        if (index >= 0) synthesisWaiters.splice(index, 1);
        attempt();
      };
      const settle = (error, slot) => {
        signal?.removeEventListener("abort", abandon);
        if (error) reject(error);
        else resolve(slot);
        return true;
      };
      const attempt = () => {
        if (closed) return settle(closedError());
        if (signal?.aborted) return settle(signal.reason);
        const slot = idleSlotFor(modelId);
        if (!slot) return false;
        slot.busy = true;
        return settle(null, slot);
      };
      const waiter = { attempt };
      if (attempt()) return;
      signal?.addEventListener("abort", abandon, { once: true });
      synthesisWaiters.push(waiter);
    });
  }

  function releaseSynthesisSlot(slot) {
    slot.busy = false;
    slot.used = ++useClock;
    while (synthesisWaiters.length) {
      const waiter = synthesisWaiters.shift();
      if (waiter.attempt()) return;
    }
  }

  async function startRecognizers(configurationForWorkers) {
    const started = await Promise.allSettled(Array.from({ length: recognitionWorkers }, () => createRecognizer(configurationForWorkers, {
      options: { vocabulary: recognitionVocabulary, minimumRms, tailPaddingSeconds }
    })));
    const failed = started.find(result => result.status === "rejected");
    if (failed) {
      await closeAll(started.map(result => result.value));
      throw failed.reason;
    }
    for (const { value } of started) recognitionSlots.push({ process: value, recordings: 0, replacing: null });
  }

  // The slot's process, or its replacement when the process ended.
  function recognizerFor(slot) {
    if (slot.process?.running) return Promise.resolve(slot.process);
    slot.replacing ??= createRecognizer(workerRecognizerConfiguration, {
      options: { vocabulary: recognitionVocabulary, minimumRms, tailPaddingSeconds }
    }).then(process => {
      if (closed) { void process.close(); throw closedError(); }
      slot.process = process;
      return process;
    }).finally(() => { slot.replacing = null; });
    return slot.replacing;
  }

  let workerRecognizerConfiguration = recognizerConfiguration;
  let hotwordCount;
  try {
    if (added.length || recognizerConfiguration.hotwordsFile) {
      const lines = await hotwordLines(recognizerConfiguration.hotwordsFile, added);
      hotwordCount = lines.length;
      if (added.length) {
        hotwordsFolder = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-hotwords-"));
        const file = path.join(hotwordsFolder, "hotwords.txt");
        await writeFile(file, `${lines.join("\n")}\n`, { mode: 0o600 });
        workerRecognizerConfiguration = { ...recognizerConfiguration, hotwordsFile: file };
      }
    }
    // Validate every configured voice in one slot without retaining its native
    // allocations, finishing with the default; the other slots load the default.
    const defaultModel = voices.find(voice => voice.id === defaultVoice).modelId || "default";
    const modelIds = new Set(voices.map(voice => voice.modelId || "default"));
    modelIds.delete(defaultModel);
    const validating = (async () => {
      for (const modelId of [...modelIds, defaultModel]) await selectModel(synthesisSlots[0], modelId);
      await Promise.all(synthesisSlots.slice(1).map(slot => selectModel(slot, defaultModel)));
    })();
    const [recognizers, synthesizers] = await Promise.allSettled([startRecognizers(workerRecognizerConfiguration), validating]);
    if (recognizers.status === "rejected" || synthesizers.status === "rejected") {
      throw recognizers.reason || synthesizers.reason;
    }
  } catch (error) {
    await close();
    throw error;
  }

  /**
   * One recording's recognition, on the recognition process with the fewest
   * recordings. Its steps answer promises and run in the order called.
   * @param {object} [options]
   * @param {(text: string) => void} [options.onPartial] Called with the words so far whenever they change.
   * @param {(text: string) => void} [options.onEndpoint] Called when a continuous recording's speaker pauses after words.
   * @param {boolean} [options.continuous]
   */
  function createListeningSession(options = {}) {
    if (closed) throw closedError();
    // A process that ended is replaced at once; recordings go to live ones meanwhile.
    for (const candidate of recognitionSlots) {
      if (!candidate.process?.running) recognizerFor(candidate).catch(() => null);
    }
    const live = recognitionSlots.filter(candidate => candidate.process?.running);
    const slot = (live.length ? live : recognitionSlots)
      .reduce((best, candidate) => candidate.recordings < best.recordings ? candidate : best);
    slot.recordings += 1;
    let released = false;
    let cancelled = false;
    let acceptedSamples = 0;
    const release = () => {
      if (released) return;
      released = true;
      slot.recordings -= 1;
    };
    const recording = recognizerFor(slot).then(process => process.openRecording(options));
    recording.catch(release);
    async function step(operation) {
      const current = await recording;
      try { return await operation(current); } finally { acceptedSamples = current.acceptedSamples; }
    }
    function acceptPcm(frame) {
      return step(current => current.acceptPcm(frame));
    }
    function reset() {
      return step(current => current.reset());
    }
    function isEndpoint() {
      return step(current => current.isEndpoint());
    }
    async function finish() {
      try { return await step(current => current.finish()); } finally { release(); }
    }
    function cancel() {
      if (cancelled) return;
      cancelled = true;
      release();
      recording.then(current => current.cancel(), () => null);
    }
    return Object.freeze({
      acceptPcm,
      cancel,
      finish,
      isEndpoint,
      reset,
      get acceptedSamples() {
        return acceptedSamples;
      }
    });
  }

  async function synthesize(text, { onAudio = () => null, signal = null, voiceId = defaultVoice } = {}) {
    const voice = voices.find(voice => voice.id === voiceId);
    if (!voice) throw new Error("The selected voice is not available.");
    if (closed) throw closedError();
    if (signal?.aborted) return { cancelled: true, sampleRate, samples: 0 };
    let slot;
    try {
      slot = await acquireSynthesisSlot(voice.modelId || "default", signal);
    } catch (error) {
      if (!signal?.aborted) throw error;
      return { cancelled: true, sampleRate, samples: 0 };
    }
    try {
      let model;
      try {
        model = await selectModel(slot, voice.modelId || "default", signal);
      } catch (error) {
        if (!signal?.aborted) throw error;
        return { cancelled: true, sampleRate, samples: 0 };
      }
      return await model.synthesize(String(text || ""), { speakerId: voice.speakerId, speed: voice.speed ?? 1, onAudio, signal });
    } finally { releaseSynthesisSlot(slot); }
  }

  // Each process's first work loads its model's arenas; do it before the host accepts anyone.
  async function warmup() {
    const voice = voices.find(entry => entry.id === defaultVoice);
    await Promise.all([
      ...recognitionSlots.map(slot => slot.process.warmup()),
      ...synthesisSlots.map(slot => slot.model.synthesize("Ready.", { speakerId: voice.speakerId, speed: voice.speed ?? 1 }))
    ]);
    return true;
  }

  async function close() {
    closed = true;
    for (const waiter of synthesisWaiters.splice(0)) waiter.attempt();
    await Promise.all([
      ...recognitionSlots.map(async slot => {
        await slot.process?.close();
        if (slot.replacing) await slot.replacing.then(process => process.close(), () => null);
      }),
      ...synthesisSlots.map(async slot => {
        const loading = slot.loading;
        await slot.model?.close();
        if (loading) await (await loading.catch(() => null))?.close();
      })
    ]);
    if (hotwordsFolder) await rm(hotwordsFolder, { recursive: true, force: true });
  }

  const runtime = recognitionSlots[0].process.runtime;
  return Object.freeze({
    close,
    concurrency: Object.freeze({ recognition: recognitionWorkers, synthesis: synthesisWorkers }),
    createListeningSession,
    defaultVoice,
    recognitionModels: Object.freeze([Object.freeze({
      id: await recognitionModelId(root),
      ...(Number.isSafeInteger(hotwordCount) ? { hotwords: hotwordCount } : {}),
      spellings: recognitionSpellingCount(recognitionVocabulary)
    })]),
    runtime,
    sampleRate,
    synthesisTimeoutMs: 2 * SYNTHESIS_REQUEST_TIMEOUT_MS,
    synthesize,
    versions: Object.freeze({
      "@jskit-ai/assistant-voice-sherpa": PACKAGE_VERSION,
      ...(installedVersion("sherpa-onnx-node") ? { "sherpa-onnx-node": installedVersion("sherpa-onnx-node") } : {})
    }),
    voices: Object.freeze(voices.map(voice => Object.freeze({ ...voice }))),
    warmup
  });
}

export {
  createSherpaSpeechEngine,
  defaultWorkerCount,
  positiveActivePathCount,
  positiveThreadCount
};
