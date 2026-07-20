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

test("UI testing guidance uses private local exchange support and managed storage state", async () => {
  const pattern = await readFile(path.join(packageRoot, "patterns/ui-testing.md"), "utf8");
  const humanGuide = await readFile(path.join(packageRoot, "site/guide/app-setup/authentication.md"), "utf8");
  const distributedGuide = await readFile(path.join(packageRoot, "guide/agent/app-setup/authentication.md"), "utf8");

  for (const source of [pattern, humanGuide, distributedGuide]) {
    assert.match(source, /@jskit-ai\/auth-web\/test\/playwright/u);
    assert.match(source, /x-jskit-dev-auth-secret/u);
    assert.match(source, /JSKIT_PLAYWRIGHT_STORAGE_STATE/u);
    assert.doesNotMatch(source, /page\.evaluate\(async/u);
    assert.doesNotMatch(source, /fetch\("\/api\/dev-auth\/login-as"/u);
  }
});
