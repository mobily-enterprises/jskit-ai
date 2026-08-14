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
  assert.match(
    pattern,
    /create the validated table.*development database first.*Then make\s+`jskit generate crud-server-generator scaffold \.\.\.`/s
  );
  assert.match(pattern, /every persisted app-owned table must go through that server CRUD step first/);
  assert.match(pattern, /do not hand-write a separate CRUD migration/);
  assert.match(pattern, /When a weird-custom persistence lane is proposed/);
  assert.match(pattern, /Before taking that path, stop and ask the developer for explicit approval/);
  assert.match(pattern, /Record the exact approval and the approved exception in `.jskit\/WORKBOARD.md` before coding/);
  assert.match(pattern, /Without that explicit approval record, do not take the weird-custom persistence path/);
});

test("crud scaffolding pattern defines the generated database key contract", async () => {
  const pattern = await readFile(path.join(packageRoot, "patterns/crud-scaffolding.md"), "utf8");
  const generatorGuide = await readFile(path.join(packageRoot, "site/guide/generators/crud-generators.md"), "utf8");

  for (const source of [pattern, generatorGuide]) {
    assert.match(source, /single-column.*primary key/is);
    assert.match(source, /foreign key.*single-column/is);
    assert.match(source, /never.*relationship\s+targets/is);
    assert.match(source, /composite\s+foreign\s+key/is);
    assert.match(source, /workspace_id/);
  }

  assert.match(pattern, /fresh disposable database/);
  assert.match(pattern, /production, legacy, historical/);
  assert.match(pattern, /cross-workspace relationship tests/);
  assert.match(pattern, /`.jskit\/APP_BLUEPRINT.md`/);
});

test("agent database guidance distinguishes generated baselines from additive evolution", async () => {
  const relativePaths = [
    "patterns/crud-scaffolding.md",
    "site/guide/generators/crud-generators.md",
    "site/guide/app-setup/database-layer.md",
    "guide/agent/generators/crud-generators.md",
    "guide/agent/app-setup/database-layer.md"
  ];
  const sources = await Promise.all(
    relativePaths.map((relativePath) => readFile(path.join(packageRoot, relativePath), "utf8"))
  );

  for (const source of sources) {
    assert.match(source, /Never modify or replace a generator-owned baseline migration/);
    assert.match(source, /package-owned\s+additive migration|migration owned by\s+the table's app-local package/is);
    assert.match(source, /install-migration/);
  }

  const pattern = sources[0];
  const databaseGuide = sources[2];
  assert.match(pattern, /npx jskit create migration/);
  assert.match(databaseGuide, /SQL inside the source-controlled migration is supported/);
  assert.match(databaseGuide, /Ad-hoc SQL applied only to a\s+development or live database is not a migration/is);
});

test("crud guidance keeps default response selection resource-owned", async () => {
  const clientPattern = await readFile(path.join(packageRoot, "patterns/client-requests.md"), "utf8");
  const generatorGuide = await readFile(path.join(packageRoot, "site/guide/generators/crud-generators.md"), "utf8");

  for (const source of [clientPattern, generatorGuide]) {
    assert.match(source, /every field declared for output|all resource-defined output fields/is);
    assert.match(source, /lookup.*(?:target )?resource.*output/is);
    assert.match(source, /contract\.response\.defaultExclude/);
    assert.match(source, /specialised.*fieldset|fieldset.*specialised/is);
    assert.match(source, /must never be exposed.*output schema|never.*exposed.*do not belong in the output schema/is);
  }

  assert.doesNotMatch(generatorGuide, /UI_LIST_REQUEST_FIELDSETS|UI_VIEW_REQUEST_FIELDSETS/);
});

test("crud guidance requires the standard list and view query validator groups", async () => {
  const relativePaths = [
    "patterns/filters.md",
    "patterns/server-search.md",
    "site/guide/generators/advanced-cruds.md",
    "site/guide/generators/crud-generators.md",
    "guide/agent/generators/advanced-cruds.md",
    "guide/agent/generators/crud-generators.md"
  ];
  const sources = await Promise.all(
    relativePaths.map((relativePath) => readFile(path.join(packageRoot, relativePath), "utf8"))
  );

  for (const source of sources) {
    assert.match(source, /createStandardCrudListQueryValidators/);
    assert.match(source, /createStandardCrudViewQueryValidators/);
    assert.match(source, /listFilterQueryValidator/);
  }

  for (const source of sources.slice(0, 3)) {
    assert.doesNotMatch(
      source,
      /listCursorPaginationQueryValidator,\s*listSearchQueryValidator,\s*listParentFilterQueryValidator/s
    );
  }

  const filtersPattern = sources[0];
  const advancedGuide = sources[2];
  assert.match(filtersPattern, /Never supply the\s+same filter validator through both\s+paths/);
  assert.match(advancedGuide, /Never provide the\s+same filter validator through both\s+paths/);
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

test("fresh CRUD and generated delete guidance is complete and distributed", async () => {
  const relativePaths = [
    "site/guide/generators/crud-generators.md",
    "patterns/crud-scaffolding.md",
    "patterns/live-actions.md",
    "skills/jskit/references/app-operations.md",
    "skills/jskit/references/crud-operations.md"
  ];
  const sources = await Promise.all(
    relativePaths.map((relativePath) => readFile(path.join(packageRoot, relativePath), "utf8"))
  );
  const allGuidance = sources.join("\n");

  assert.match(allGuidance, /npx @jskit-ai\/create-app notes/);
  assert.match(allGuidance, /npx --no-install jskit add package database-runtime-mysql/);
  assert.match(allGuidance, /crud-server-generator scaffold/);
  assert.match(allGuidance, /npm install[\s\S]*crud-ui-generator crud/);
  assert.match(allGuidance, /--delete-confirmation/);
  assert.match(allGuidance, /CrudViewScreen/);
  assert.match(allGuidance, /CrudDeleteAction/);
  assert.match(allGuidance, /useCrudDeleteAction\(\)/);
  assert.match(allGuidance, /useCommand\(\)/);
  assert.match(allGuidance, /custom `--id-param`|Custom `--id-param`/);
  assert.match(allGuidance, /shared resource.*`DELETE` operation/is);
  assert.match(allGuidance, /Do not substitute raw `fetch\(\)`|Do not rebuild that command with raw `fetch\(\)`/);
});

test("existing-app temporal migration is prominent and rejects legacy coercion", async () => {
  const index = await readFile(path.join(packageRoot, "site/guide/index.md"), "utf8");
  const generatorGuide = await readFile(
    path.join(packageRoot, "site/guide/generators/crud-generators.md"),
    "utf8"
  );
  const skillReference = await readFile(
    path.join(packageRoot, "skills/jskit/references/crud-operations.md"),
    "utf8"
  );
  const guidance = `${generatorGuide}\n${skillReference}`;

  assert.match(index, /Existing-app migration checklist/);
  assert.match(generatorGuide, /^## Existing-app migration checklist$/m);
  assert.match(guidance, /json-rest-schema@\^1\.0\.17|json-rest-schema` 1\.0\.17/);
  assert.match(guidance, /JavaScript `Date`/);
  assert.match(guidance, /RFC 3339/);
  assert.match(guidance, /epochMilliseconds/);
  assert.match(guidance, /epochSeconds/);
  assert.match(guidance, /temporalPrecision/);
  assert.match(guidance, /no compatibility alias|rather than a legacy compatibility layer/);
});
