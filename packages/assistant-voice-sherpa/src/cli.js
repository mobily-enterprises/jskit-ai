import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createSherpaSpeechEngine } from "./sherpaSpeechEngine.js";
import { createVoiceAccessToken } from "@jskit-ai/assistant-voice/server";
import { createVoiceDaemon } from "@jskit-ai/assistant-voice/server";
import { verifyVoiceModelContract } from "./voiceModelContract.js";

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

async function accessKeyFromFile(filePath) {
  return Buffer.from((await readFile(path.resolve(filePath), "utf8")).trim(), "utf8");
}

function positiveInteger(value, fallback) {
  const integer = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(integer) && integer > 0 ? integer : fallback;
}

function usage() {
  return [
    "JSKIT assistant voice service",
    "",
    "Commands:",
    "  serve --models-root PATH --key-file PATH [--host ADDRESS] [--port NUMBER] [--config FILE]",
    "  prepare --models-root PATH [--pack cori|piper|kokoro] [--sources-file FILE] [--download-cache PATH] [--hotwords-file PATH]",
    "  verify --models-root PATH",
    "  token --key-file PATH --tenant NAME"
  ].join("\n");
}

async function runVoiceCli(argv = process.argv.slice(2), { createDaemon = createVoiceDaemon } = {}) {
  const { command, options } = argumentMap(argv);
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "token") {
    const key = await accessKeyFromFile(requiredOption(options, "key-file", "JSKIT_VOICE_ACCESS_KEY_FILE"));
    const tenant = requiredOption(options, "tenant", "JSKIT_VOICE_TENANT");
    process.stdout.write(`${createVoiceAccessToken({ key, tenant })}\n`);
    return;
  }
  const modelsRoot = path.resolve(requiredOption(options, "models-root", "JSKIT_VOICE_MODELS_ROOT"));
  if (command === "prepare") {
    const script = fileURLToPath(new URL("../tooling/prepare-models.sh", import.meta.url));
    const env = { ...process.env, JSKIT_VOICE_MODELS_ROOT: modelsRoot, JSKIT_VOICE_NODE_BIN: process.execPath };
    for (const [option, variable] of Object.entries({
      "download-cache": "DOWNLOAD_CACHE", "archive-seed-root": "ARCHIVE_SEED_ROOT",
      "retain-downloads": "RETAIN_DOWNLOADS", "hotwords-file": "HOTWORDS_FILE"
    })) if (options[option]) env[`JSKIT_VOICE_${variable}`] = options[option];
    const pack = options.pack || process.env.JSKIT_VOICE_PACK || "cori";
    const manifests = { cori: "voice-models.json", piper: "voice-models-piper.json", kokoro: "voice-models-kokoro.json" };
    if (!Object.hasOwn(manifests, pack)) throw new Error("Choose --pack cori, piper or kokoro, or supply --sources-file for your own model pack.");
    env.JSKIT_VOICE_SOURCES_FILE = options["sources-file"] || process.env.JSKIT_VOICE_SOURCES_FILE || fileURLToPath(new URL(
      `../models/${manifests[pack]}`, import.meta.url));
    await new Promise((resolve, reject) => {
      const child = spawn("bash", [script], { env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Voice model preparation failed (${signal || code}).`)));
    });
    return;
  }
  if (command === "verify") {
    await verifyVoiceModelContract({ modelsRoot });
    process.stdout.write(`Voice model contract verified at ${modelsRoot}.\n`);
    return;
  }
  if (command !== "serve") {
    throw new Error(`Unknown voice command: ${command}.\n\n${usage()}`);
  }
  // Installation and the explicit check command verify integrity. Native model
  // loading reports missing/invalid files without rereading every byte to hash it.
  const configFile = options.config || process.env.JSKIT_VOICE_CONFIG;
  const configuration = await readFile(configFile ? path.resolve(configFile) : path.join(modelsRoot, "speech.json"), "utf8")
    .then(JSON.parse).catch(error => { if (!configFile && error.code === "ENOENT") return {}; throw error; });
  const engine = await createSherpaSpeechEngine({
    modelsRoot,
    configuration,
    recognizerActivePaths: positiveInteger(
      options["stt-active-paths"] || process.env.JSKIT_VOICE_STT_ACTIVE_PATHS,
      16
    ),
    recognizerThreads: positiveInteger(options["stt-threads"] || process.env.JSKIT_VOICE_STT_THREADS, 1),
    synthesizerThreads: positiveInteger(options["tts-threads"] || process.env.JSKIT_VOICE_TTS_THREADS, 1)
  });
  let daemon;
  let address;
  try {
    daemon = await createDaemon({
      accessKey: await accessKeyFromFile(requiredOption(options, "key-file", "JSKIT_VOICE_ACCESS_KEY_FILE")),
      engine,
      host: String(options.host || process.env.JSKIT_VOICE_HOST || "127.0.0.1"),
      maximumConnections: positiveInteger(
        options["max-connections"] || process.env.JSKIT_VOICE_MAX_CONNECTIONS,
        8
      ),
      maximumConnectionsPerTenant: positiveInteger(
        options["max-connections-per-tenant"] || process.env.JSKIT_VOICE_MAX_CONNECTIONS_PER_TENANT,
        2
      ),
      maximumQueuedSpeech: positiveInteger(
        options["max-queued-speech"] || process.env.JSKIT_VOICE_MAX_QUEUED_SPEECH,
        4
      ),
      port: positiveInteger(options.port || process.env.JSKIT_VOICE_PORT, 3092)
    });
    address = await daemon.start();
  } catch (error) { await engine.close(); throw error; }
  process.stdout.write(`Assistant voice ready on ${address.address}:${address.port}.\n`);
  let stopping = false;
  const stop = async () => {
    if (stopping) {
      return;
    }
    stopping = true;
    try { await daemon.close(); } finally { await engine.close(); }
  };
  process.once("SIGINT", () => void stop().then(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
}

export {
  argumentMap,
  runVoiceCli
};
