import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function pathExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

test("guardrail scripts are owned by @jskit-ai/app-scripts", async () => {
  const localGuardrailFiles = [
    "bin/checkProcessEnvUsage.js",
    "bin/syncApiContractsReadme.js",
    "server/lib/readmeApiContracts.js"
  ];

  for (const relativePath of localGuardrailFiles) {
    const absolutePath = path.resolve(APP_ROOT, relativePath);
    assert.equal(await pathExists(absolutePath), false, `Unexpected app-local guardrail file found: ${relativePath}`);
  }
});
