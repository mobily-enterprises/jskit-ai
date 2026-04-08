import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

async function readTemplateFile(relativePath) {
  return readFile(path.join(packageRoot, relativePath), "utf8");
}

test("generated assistant client index exports the descriptor-declared client provider", async () => {
  const source = await readTemplateFile("templates/src/local-package/client/index.js");

  assert.match(source, /export \{ AssistantClientProvider \} from "\.\/providers\/AssistantClientProvider\.js";/);
});

test("generated assistant actions do not emit legacy action visibility fields", async () => {
  const source = await readTemplateFile("templates/src/local-package/server/actions.js");

  assert.doesNotMatch(source, /\bvisibility:/);
});
