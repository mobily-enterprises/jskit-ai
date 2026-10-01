#!/usr/bin/env node

import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  sha256File,
  VOICE_MODEL_CONTRACT_SCHEMA
} from "../src/voiceModelContract.js";

async function collectFiles(root, relativeRoot = "") {
  const directory = path.join(root, relativeRoot);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (relativePath === "voice-models.json") {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, relativePath));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Voice model runtime pack contains a non-file entry: ${relativePath}.`);
    }
    const pathname = path.join(root, relativePath);
    const metadata = await stat(pathname);
    files.push({
      bytes: metadata.size,
      path: relativePath.split(path.sep).join("/"),
      sha256: await sha256File(pathname)
    });
  }
  return files;
}

const root = path.resolve(String(process.argv[2] || ""));
if (!process.argv[2] || root === path.parse(root).root) {
  throw new Error("Usage: build-voice-model-contract.mjs MODELS_ROOT");
}
const contract = {
  createdBy: "@jskit-ai/assistant-voice-sherpa/prepare",
  files: await collectFiles(root),
  schema: VOICE_MODEL_CONTRACT_SCHEMA
};
await writeFile(
  path.join(root, "voice-models.json"),
  `${JSON.stringify(contract, null, 2)}\n`,
  { mode: 0o644 }
);
process.stdout.write(`Recorded ${contract.files.length} voice model files.\n`);
