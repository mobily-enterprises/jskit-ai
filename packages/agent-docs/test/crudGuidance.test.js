import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("distributed agent docs no longer expose workflow files as active guidance", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const distributedGuide = await readFile(path.join(packageRoot, "DISTR_AGENT.md"), "utf8");

  assert.doesNotMatch(JSON.stringify(packageJson.files), /workflow/);
  assert.match(distributedGuide, /jskit session create/);
  assert.match(distributedGuide, /Do not use the old prose workflow model/);
  assert.doesNotMatch(distributedGuide, /workflow\/scoping\.md/);
  assert.doesNotMatch(distributedGuide, /workflow\/review\.md/);
});
