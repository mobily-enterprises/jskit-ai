import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createSherpaSpeechEngine, defaultWorkerCount } from "./sherpaSpeechEngine.js";
import { createVoiceDaemon } from "@jskit-ai/assistant-voice/server";
import { parseRecognitionHotwords, parseRecognitionSpellings } from "@jskit-ai/assistant-voice/shared/protocol";
import { verifyVoiceModelContract } from "./voiceModelContract.js";

// Combined packs list their manifests in merge order: base, kitten, kokoro.
const PACKS = Object.freeze({
  cori: ["voice-models.json"],
  piper: ["voice-models-piper.json"],
  kitten: ["voice-models-kitten.json"],
  "piper-kitten": ["voice-models-piper.json", "voice-models-kitten.json"],
  kokoro: ["voice-models-kokoro.json"],
  "kokoro-q8f16": ["voice-models-kokoro-q8f16.json"],
  "piper-kitten-kokoro-q8f16": ["voice-models-piper.json", "voice-models-kitten.json", "voice-models-kokoro-q8f16.json"]
});
const PACK_NAMES = Object.keys(PACKS);

function mergeVoiceModelSources([base, kitten, kokoro]) {
  base.models.push(...kitten.models.filter(model => model.kind === "tts"));
  base.configuration.voices.unshift(...kitten.configuration.voices);
  Object.assign(base.configuration.synthesizers, kitten.configuration.synthesizers);
  if (kokoro) {
    base.models.push(...kokoro.models.filter(model => model.kind === "tts"));
    base.configuration.voices.push(...kokoro.configuration.voices.map(voice => ({ ...voice, modelId: "kokoro" })));
    base.configuration.synthesizers.kokoro = kokoro.configuration.synthesizer;
    base.onnxMetadata = kokoro.onnxMetadata;
    base.textFiles = kokoro.textFiles;
  }
  base.configuration.outputSampleRate = 22050;
  return base;
}

function argumentMap(values = []) {
  const [command = "help", ...tail] = values;
  const options = {};
  for (let index = 0; index < tail.length; index += 1) {
    const key = String(tail[index] || "");
    if (!key.startsWith("--")) {
      throw new Error(`Unexpected argument: ${key}.`);
    }
    const value = tail[index + 1];
    if (!value || String(value).startsWith("--")) {
      throw new Error(`Missing value for ${key}.`);
    }
    options[key.slice(2)] = String(value);
    index += 1;
  }
  return { command, options };
}

function requiredOption(options, key, environmentKey = "") {
  const value = String(options[key] || (environmentKey ? process.env[environmentKey] : "") || "").trim();
  if (!value) {
    throw new Error(`Voice command requires --${key}.`);
  }
  return value;
}

function positiveInteger(value, fallback) {
  const integer = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(integer) && integer > 0 ? integer : fallback;
}

function setting(options, key, environmentKey) {
  return options[key] || process.env[environmentKey];
}

// A host's hotwords (one per line) or spellings ("spoken phrase => Written
// form" per line) file; a refusal names the file and line.
async function readRecognitionFile(filePath, parse, none) {
  if (!filePath) return none;
  const file = path.resolve(filePath);
  try {
    return parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof TypeError) throw new TypeError(`${file}: ${error.message}`);
    throw error;
  }
}

function usage() {
  return [
    "JSKIT assistant voice service",
    "",
    "Commands:",
    "  serve --models-root PATH --credentials-file PATH [--hotwords-file PATH] [--spellings-file PATH] [--config FILE]",
    "        [--host ADDRESS] [--port NUMBER] [--workers N] [--recognition-workers N] [--synthesis-workers N]",
    "        [--max-connections N] [--max-connections-per-client N] [--max-queued-speech N]",
    `  prepare --models-root PATH [--pack ${PACK_NAMES.join("|")}] [--sources-file FILE] [--download-cache PATH]`,
    "  verify --models-root PATH"
  ].join("\n");
}

/**
 * The voice service's commands. A host may run serve on another engine, such
 * as a stand-in with no model for its tests: `createEngine` receives the
 * options `createSherpaSpeechEngine` takes and answers an engine with close().
 * @param {string[]} [argv]
 * @param {{ createEngine?: typeof createSherpaSpeechEngine, recognitionVocabulary?: Record<string, string> }} [options]
 * @returns {Promise<void | { address: object, close: () => Promise<void> }>} For serve, the running service.
 */
async function runVoiceCli(argv = process.argv.slice(2), { createEngine = createSherpaSpeechEngine, recognitionVocabulary = {} } = {}) {
  const { command, options } = argumentMap(argv);
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!["prepare", "serve", "verify"].includes(command)) throw new Error(`Unknown voice command: ${command}.\n\n${usage()}`);
  const modelsRoot = path.resolve(requiredOption(options, "models-root", "JSKIT_VOICE_MODELS_ROOT"));
  if (command === "prepare") {
    const script = fileURLToPath(new URL("../tooling/prepare-models.sh", import.meta.url));
    const env = { ...process.env, JSKIT_VOICE_MODELS_ROOT: modelsRoot, JSKIT_VOICE_NODE_BIN: process.execPath };
    for (const [option, variable] of Object.entries({
      "download-cache": "DOWNLOAD_CACHE", "archive-seed-root": "ARCHIVE_SEED_ROOT",
      "retain-downloads": "RETAIN_DOWNLOADS"
    })) if (options[option]) env[`JSKIT_VOICE_${variable}`] = options[option];
    const pack = options.pack || process.env.JSKIT_VOICE_PACK || "cori";
    if (!Object.hasOwn(PACKS, pack)) throw new Error(`Choose --pack ${PACK_NAMES.slice(0, -1).join(", ")} or ${PACK_NAMES.at(-1)}, or supply --sources-file for your own model pack.`);
    const manifests = PACKS[pack];
    let temporary;
    try {
      env.JSKIT_VOICE_SOURCES_FILE = options["sources-file"] || process.env.JSKIT_VOICE_SOURCES_FILE;
      if (!env.JSKIT_VOICE_SOURCES_FILE && manifests.length > 1) {
        const sources = mergeVoiceModelSources(await Promise.all(manifests.map(async manifest => (
          JSON.parse(await readFile(new URL(`../models/${manifest}`, import.meta.url), "utf8"))
        ))));
        temporary = await mkdtemp(path.join(os.tmpdir(), "jskit-voice-sources-"));
        env.JSKIT_VOICE_SOURCES_FILE = path.join(temporary, "sources.json");
        await writeFile(env.JSKIT_VOICE_SOURCES_FILE, JSON.stringify(sources, null, 2) + "\n");
      }
      env.JSKIT_VOICE_SOURCES_FILE ||= fileURLToPath(new URL(`../models/${manifests[0]}`, import.meta.url));
      await new Promise((resolve, reject) => {
        const child = spawn("bash", [script], { env, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Voice model preparation failed (${signal || code}).`)));
      });
    } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    return;
  }
  if (command === "verify") {
    await verifyVoiceModelContract({ modelsRoot });
    process.stdout.write(`Voice model contract verified at ${modelsRoot}.\n`);
    return;
  }
  // Installation and the explicit check command verify integrity. Native model
  // loading reports missing/invalid files without rereading every byte to hash it.
  const credentialsFile = path.resolve(requiredOption(options, "credentials-file", "JSKIT_VOICE_CREDENTIALS_FILE"));
  const configFile = options.config || process.env.JSKIT_VOICE_CONFIG;
  const configuration = await readFile(configFile ? path.resolve(configFile) : path.join(modelsRoot, "speech.json"), "utf8")
    .then(JSON.parse).catch(error => { if (!configFile && error.code === "ENOENT") return {}; throw error; });
  const workers = positiveInteger(setting(options, "workers", "JSKIT_VOICE_WORKERS"), defaultWorkerCount());
  const engine = await createEngine({
    modelsRoot,
    configuration: { ...configuration, recognitionVocabulary: configuration.recognitionVocabulary ?? recognitionVocabulary },
    hotwords: await readRecognitionFile(setting(options, "hotwords-file", "JSKIT_VOICE_HOTWORDS_FILE"), parseRecognitionHotwords, []),
    spellings: await readRecognitionFile(setting(options, "spellings-file", "JSKIT_VOICE_SPELLINGS_FILE"), parseRecognitionSpellings, {}),
    recognitionWorkers: positiveInteger(setting(options, "recognition-workers", "JSKIT_VOICE_RECOGNITION_WORKERS"), workers),
    synthesisWorkers: positiveInteger(setting(options, "synthesis-workers", "JSKIT_VOICE_SYNTHESIS_WORKERS"), workers),
    recognizerActivePaths: positiveInteger(setting(options, "stt-active-paths", "JSKIT_VOICE_STT_ACTIVE_PATHS"), 16),
    recognizerThreads: positiveInteger(setting(options, "stt-threads", "JSKIT_VOICE_STT_THREADS"), 1),
    synthesizerThreads: positiveInteger(setting(options, "tts-threads", "JSKIT_VOICE_TTS_THREADS"), 1)
  });
  let daemon;
  let address;
  try {
    // Unset limits size themselves from the engine's pools.
    daemon = createVoiceDaemon({
      credentialsFile,
      engine,
      host: String(setting(options, "host", "JSKIT_VOICE_HOST") || "127.0.0.1"),
      maximumConnections: positiveInteger(setting(options, "max-connections", "JSKIT_VOICE_MAX_CONNECTIONS"), undefined),
      maximumConnectionsPerClient: positiveInteger(setting(options, "max-connections-per-client", "JSKIT_VOICE_MAX_CONNECTIONS_PER_CLIENT"), undefined),
      maximumQueuedSpeech: positiveInteger(setting(options, "max-queued-speech", "JSKIT_VOICE_MAX_QUEUED_SPEECH"), undefined),
      port: positiveInteger(setting(options, "port", "JSKIT_VOICE_PORT"), 3092)
    });
    address = await daemon.start();
  } catch (error) { await daemon?.close(); await engine.close(); throw error; }
  process.stdout.write(`Assistant voice ready on ${address.address}:${address.port}.\n`);
  let stopping = null;
  const stop = () => {
    stopping ??= (async () => {
      try { await daemon.close(); } finally { await engine.close(); }
    })();
    return stopping;
  };
  const exitOnSignal = () => void stop().then(() => process.exit(0));
  process.once("SIGINT", exitOnSignal);
  process.once("SIGTERM", exitOnSignal);
  return Object.freeze({
    address,
    async close() {
      process.off("SIGINT", exitOnSignal);
      process.off("SIGTERM", exitOnSignal);
      await stop();
    }
  });
}

export {
  argumentMap,
  runVoiceCli
};
