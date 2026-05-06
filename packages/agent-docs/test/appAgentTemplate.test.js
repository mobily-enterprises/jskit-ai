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
  assert.match(body, /server CRUD with `jskit generate crud-server-generator scaffold/);
  assert.match(body, /every persisted app-owned table must have its own server CRUD package/);
  assert.match(body, /`jskit doctor` is expected to fail/);
  assert.match(body, /do not hand-write a separate migration/);
  assert.match(body, /Do not generate CRUD UI or hand-build CRUD routes before the server CRUD package and shared resource file exist/);
  assert.match(body, /`feature-server-generator` is for workflows, orchestration, and other non-CRUD server features/);
  assert.match(body, /Keep direct knex minimal and exceptional/);
  assert.match(body, /If you believe a weird-custom repository or persistence lane is necessary, stop and ask the developer first/);
  assert.match(body, /Record the exact approval and the approved exception in `.jskit\/WORKBOARD.md` before coding/);
  assert.match(body, /Plan implementation work as vertical slices/);
  assert.match(body, /Avoid horizontal chunk plans/);

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
  assert.match(body, /jskit app verify-ui/);
  assert.match(body, /--against <base-ref>/);
  assert.match(body, /use the app's development-only auth bypass or session bootstrap path/);
  assert.match(body, /POST \/api\/dev-auth\/login-as/);
});
