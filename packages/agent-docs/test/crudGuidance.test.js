import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("distributed agent docs publish the current guide, patterns, references, and skill", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const agentGuide = await readFile(path.join(packageRoot, "guide/agent/index.md"), "utf8");

  assert.deepEqual(packageJson.files, ["guide", "patterns", "reference", "skills", "templates"]);
  assert.match(agentGuide, /^# Guide$/m);
  assert.match(agentGuide, /^## Start here$/m);
});

test("CRUD guidance is source-pattern-first and contains no generator workflow", async () => {
  const relativePaths = [
    "patterns/crud-authoring.md",
    "patterns/INDEX.md",
    "skills/jskit/references/crud-operations.md"
  ];
  const sources = await Promise.all(
    relativePaths.map((relativePath) => readFile(path.join(packageRoot, relativePath), "utf8"))
  );
  const combined = sources.join("\n");

  assert.match(combined, /crud\/resource-contract/u);
  assert.match(combined, /crud\/json-api-resource-package/u);
  assert.match(combined, /crud\/crud-screen-set/u);
  assert.match(combined, /defineCrudResource\(\)/u);
  assert.match(combined, /defineCrudJsonApiFeature\(\)/u);
  assert.match(combined, /immutable.*migration/iu);
  assert.match(combined, /negative cross-owner|cross-owner access/u);
  assert.doesNotMatch(combined, /crud-server-generator|crud-ui-generator|\.jskit\/WORKBOARD/u);
  assert.match(combined, /Avoid.*ownership receipts/isu);
});
