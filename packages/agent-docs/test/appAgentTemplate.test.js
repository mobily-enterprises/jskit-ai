import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(packageRoot, "templates/app/AGENTS.md");

test("app agent template includes mandatory JSKIT start and done gates", async () => {
  const body = await readFile(templatePath, "utf8");

  assert.match(body, /^## Mandatory Start Gate$/m);
  assert.match(body, /Read receipt:/);
  assert.match(body, /Active chunk:/);
  assert.match(body, /Generator decision:/);
  assert.match(body, /Relevant patterns:/);
  assert.match(body, /Active rules from docs:/);
  assert.match(body, /prefer `jskit generate \.\.\.` over creating them from scratch/);

  assert.match(body, /^## Mandatory Done Gate$/m);
  assert.match(body, /Deslop review:/);
  assert.match(body, /JSKIT review:/);
  assert.match(body, /Material\/Vuetify review:/);
  assert.match(body, /Playwright:/);
  assert.match(body, /Verification:/);
  assert.match(body, /Files changed:/);
  assert.match(body, /Commands run:/);
  assert.match(body, /Remaining unverified:/);
  assert.match(body, /Any chunk that adds or changes user-facing UI must include a Playwright check/);
  assert.match(body, /use the app's development-only auth bypass or session bootstrap path/);
  assert.match(body, /POST \/api\/dev-auth\/login-as/);
});
