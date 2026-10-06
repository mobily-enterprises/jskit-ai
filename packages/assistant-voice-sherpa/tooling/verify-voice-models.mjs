#!/usr/bin/env node

import path from "node:path";

import { verifyVoiceModelContract } from "../src/voiceModelContract.js";

const modelsRoot = String(process.argv[2] || "").trim();
if (!modelsRoot) {
  throw new Error("Usage: verify-voice-models.mjs MODELS_ROOT");
}

const resolvedRoot = path.resolve(modelsRoot);
if (resolvedRoot === path.parse(resolvedRoot).root) {
  throw new Error("Refusing to verify the filesystem root as a voice model pack.");
}

const contract = await verifyVoiceModelContract({ modelsRoot: resolvedRoot });
process.stdout.write(
  `Verified ${contract.files.length} voice model files at ${resolvedRoot}.\n`
);
