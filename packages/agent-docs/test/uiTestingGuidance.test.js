import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("review skill no longer depends on removed workflow docs", async () => {
  const skill = await readFile(path.join(packageRoot, "skills/jskit-review/SKILL.md"), "utf8");

  assert.match(skill, /current diff/);
  assert.doesNotMatch(skill, /\.\.\/\.\.\/workflow\//);
});
