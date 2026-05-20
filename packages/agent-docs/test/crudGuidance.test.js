import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("distributed agent docs no longer expose removed workflow files or commands", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const agentGuide = await readFile(path.join(packageRoot, "guide/agent/index.md"), "utf8");

  assert.doesNotMatch(JSON.stringify(packageJson.files), /workflow/);
  assert.doesNotMatch(agentGuide, /workflow\/scoping\.md/);
  assert.doesNotMatch(agentGuide, /workflow\/review\.md/);
});
