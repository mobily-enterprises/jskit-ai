import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const patternRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../patterns/feature-package"
);

async function collectFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }
  await walk(root);
  return files.sort();
}

test("server feature pattern preserves the three useful package boundaries without authoring metadata", async () => {
  const document = await readFile(path.join(patternRoot, "PATTERN.md"), "utf8");
  const exampleFiles = await collectFiles(path.join(patternRoot, "example"));
  const sources = await Promise.all(exampleFiles.map((file) => readFile(file, "utf8")));
  const combinedSource = sources.join("\n");

  assert.match(document, /feature declaration, named capability inputs and outputs, and first-class\s+actions/u);
  assert.match(document, /repository-free lane/u);
  assert.match(document, /explicit custom Knex\s+repository/u);
  assert.match(combinedSource, /defineFeature/u);
  assert.match(combinedSource, /const AvailabilityEngineProvider/u);
  assert.match(combinedSource, /createWithTransaction/u);
  assert.doesNotMatch(combinedSource, /__JSKIT_|\$\{option:/u);
  assert.doesNotMatch(combinedSource, /scaffoldShape|scaffoldMode|provenance|receipt/u);

  for (const file of exampleFiles.filter((entry) => entry.endsWith(".js"))) {
    await execFileAsync(process.execPath, ["--check", file]);
  }
});
