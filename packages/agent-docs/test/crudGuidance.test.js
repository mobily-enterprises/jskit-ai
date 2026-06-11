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

test("crud scaffolding pattern requires approval for weird custom persistence lanes", async () => {
  const patternIndex = await readFile(path.join(packageRoot, "patterns/INDEX.md"), "utf8");
  const pattern = await readFile(path.join(packageRoot, "patterns/crud-scaffolding.md"), "utf8");

  assert.match(patternIndex, /crud scaffold, crud server, crud ui, table creation, migrations, direct knex, weird-custom persistence/);
  assert.match(pattern, /^# CRUD Scaffolding Patterns$/m);
  assert.match(pattern, /start with `jskit generate crud-server-generator scaffold \.\.\.`/);
  assert.match(pattern, /every persisted app-owned table must go through that server CRUD step first/);
  assert.match(pattern, /do not hand-write a separate CRUD migration/);
  assert.match(pattern, /When a weird-custom persistence lane is proposed/);
  assert.match(pattern, /Before taking that path, stop and ask the developer for explicit approval/);
  assert.match(pattern, /Record the exact approval and the approved exception in `.jskit\/WORKBOARD.md` before coding/);
  assert.match(pattern, /Without that explicit approval record, do not take the weird-custom persistence path/);
});
