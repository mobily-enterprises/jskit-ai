import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { normalizeRecognizedText, recognitionHotwords, recognitionSpellingCount, recognitionSpellings } from "../shared/protocol.js";

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

/** A listener that does not follow the recognized words ignores them. */
function ignoreRecognizedText() {}

/**
 * A speech engine with no model, for tests and catalogue proofs of a voice
 * service: it hears any audio as `recognizedText` and speaks each phrase as
 * silence, a tenth of a second per word. Its versions name it, so a service's
 * /health shows that a stand-in runs.
 * @param {object} [options]
 * @param {string} [options.recognizedText] Heard as the native engine hears it: an all-uppercase text is
 *   written with JSKIT's spellings and `spellings`.
 * @param {{ id: string, label: string, language?: string }[]} [options.voices]
 * @param {string} [options.defaultVoice]
 * @param {number} [options.sampleRate]
 * @param {number} [options.synthesisMs] How long each phrase's synthesis takes.
 * @param {string[]} [options.hotwords] Checked and counted in its recognition model, as the native engine checks and counts a host's additions.
 * @param {Record<string, string>} [options.spellings] A host's spellings, checked and applied as the native engine applies them.
 * @param {number} [options.recognitionWorkers]
 * @param {number} [options.synthesisWorkers]
 */
function createStandInSpeechEngine({
  recognizedText = "Hello world",
  voices = [{ id: "stand-in", label: "Stand-in voice", language: "en" }],
  defaultVoice = voices[0]?.id || "",
  sampleRate = 22_050,
  synthesisMs = 0,
  hotwords = [],
  spellings = {},
  recognitionWorkers = 1,
  synthesisWorkers = 1
} = {}) {
  let closed = false;
  const addedHotwords = recognitionHotwords(hotwords);
  const vocabulary = recognitionSpellings(spellings);
  const heard = normalizeRecognizedText(recognizedText, vocabulary);

  /**
   * One recording, heard as the stand-in's text once any audio arrives.
   * @param {{ onPartial?: (text: string) => void, onEndpoint?: (text: string) => void, continuous?: boolean }} [options]
   */
  function createListeningSession({ onPartial = ignoreRecognizedText, onEndpoint = ignoreRecognizedText, continuous = false } = {}) {
    let acceptedSamples = 0;
    let ended = false;
    function acceptPcm(frame) {
      if (ended) return acceptedSamples ? heard : "";
      const first = !acceptedSamples;
      acceptedSamples += frame.byteLength / 2;
      if (first) onPartial(heard);
      if (continuous && first) onEndpoint(heard);
      return heard;
    }
    function finish() {
      ended = true;
      return acceptedSamples ? heard : "";
    }
    function reset() {
      const text = acceptedSamples ? heard : "";
      acceptedSamples = 0;
      return text;
    }
    function isEndpoint() {
      return !ended && acceptedSamples > 0;
    }
    function cancel() {
      ended = true;
    }
    return Object.freeze({
      acceptPcm,
      cancel,
      finish,
      isEndpoint,
      reset,
      get acceptedSamples() { return acceptedSamples; }
    });
  }

  async function synthesize(text, { onAudio = () => null, signal = null, voiceId = defaultVoice } = {}) {
    if (closed) throw new Error("Speech engine is closed.");
    if (!voices.some(voice => voice.id === voiceId)) throw new Error("The selected voice is not available.");
    if (synthesisMs > 0) await delay(synthesisMs, undefined, { signal }).catch(() => null);
    if (signal?.aborted) return { cancelled: true, sampleRate, samples: 0 };
    const words = String(text || "").trim().split(/\s+/u).filter(Boolean).length;
    const samples = Math.round(words * sampleRate / 10);
    if (samples) onAudio(Buffer.alloc(samples * 2));
    return { cancelled: false, sampleRate, samples };
  }

  async function warmup() {}

  async function close() {
    closed = true;
  }

  return Object.freeze({
    concurrency: Object.freeze({ recognition: recognitionWorkers, synthesis: synthesisWorkers }),
    createListeningSession,
    defaultVoice,
    recognitionModels: Object.freeze([Object.freeze({
      id: "stand-in", hotwords: addedHotwords.length, spellings: recognitionSpellingCount(vocabulary)
    })]),
    sampleRate,
    synthesize,
    versions: Object.freeze({ "@jskit-ai/assistant-voice/stand-in": PACKAGE_VERSION }),
    voices: Object.freeze(voices.map(voice => Object.freeze({ ...voice }))),
    warmup,
    close
  });
}

export { createStandInSpeechEngine };
