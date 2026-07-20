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

test("crud guidance keeps canonical ownership columns distinct from domain relationships", async () => {
  const pattern = await readFile(path.join(packageRoot, "patterns/crud-scaffolding.md"), "utf8");
  const generatorGuide = await readFile(path.join(packageRoot, "site/guide/generators/crud-generators.md"), "utf8");
  const advancedGuide = await readFile(path.join(packageRoot, "site/guide/generators/advanced-cruds.md"), "utf8");

  for (const source of [pattern, generatorGuide, advancedGuide]) {
    assert.match(source, /exact.*`workspace_id`.*`user_id`|`workspace_id`.*`user_id`.*exact/s);
    assert.match(source, /`recipient_user_id`/);
    assert.match(source, /domain relationship/);
  }

  assert.match(pattern, /`--grant-role <role-id>`/);
  assert.match(pattern, /`--no-role-grant`/);
  assert.match(pattern, /every workspace-required CRUD generation must explicitly choose/);
  assert.match(generatorGuide, /even when a `member` role exists/);
  assert.match(generatorGuide, /ownership filter must match the direct reserved columns exactly/);
  assert.doesNotMatch(generatorGuide, /historical|former|Migrating commands created before/);
  assert.match(generatorGuide, /`--internal` does not imply `--no-role-grant`|This decision is independent of `--internal`/);
});
