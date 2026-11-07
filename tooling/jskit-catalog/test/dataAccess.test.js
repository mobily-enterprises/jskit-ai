import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { checkDataAccess, formatDataAccessReport } from "../scripts/data-access.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../scripts/jskit.mjs", import.meta.url));

async function withProject(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jskit-data-access-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const findingLines = (result) => result.findings.map(({ file, line, rule }) => `${file}:${line} ${rule}`);

const TABLES = Object.freeze({
  "packages/receivals/src/shared/receivalResource.js": [
    "import { defineTableResource } from \"@jskit-ai/resource-core/shared/tableResource\";",
    "// defineTableResource({ name: \"commented\", tableName: \"receivals\" }) is a comment and defines nothing.",
    "export const receivalResource = defineTableResource({",
    "  name: \"receivals\",",
    "  tableName: \"receivals\",",
    "  ownership: \"workspace\",",
    "  schema: {",
    "    name: { type: \"string\" },",
    "    tableName: { type: \"string\", search: true }",
    "  }",
    "});",
    ""
  ].join("\n"),
  "packages/lots/src/shared/lotResource.js": [
    "const TABLE = \"processing_lots\";",
    "const name = \"lotEvents\";",
    "export const lotResource = defineTableResource({ name: \"lots\", tableName: TABLE, ownership: \"workspace\" });",
    "export const lotEventResource = defineTableResource({ name, tableName: `processing_lot_events` });",
    "export const label = \"defineTableResource({ name: 'lots', tableName: 'receivals' })\";",
    ""
  ].join("\n"),
  "packages/receivals/test/receivalResource.test.js": "defineTableResource({ name: \"receivals\", tableName: \"receivals\" });\n",
  "node_modules/@jskit-ai/users-core/package.json": { name: "@jskit-ai/users-core", version: "0.1.0" },
  "node_modules/@jskit-ai/users-core/src/shared/userResource.js": "export const userResource = defineTableResource({ name: \"users\", tableName: \"users\", ownership: \"user\" });\n",
  "node_modules/@jskit-ai/resource-core/src/shared/tableResource.js": [
    "function defineTableResource(config) {",
    "  return Object.freeze({ ...config });",
    "}",
    "export const copy = (resource) => defineTableResource(normalize(resource));",
    "export { defineTableResource };",
    ""
  ].join("\n"),
  "node_modules/@jskit-ai/crud-core/patterns/crud-feature-package/example/src/shared/receivalResource.js":
    "export const example = defineTableResource({ name: \"receivals\", tableName: \"receivals\" });\n"
});

test("every table has one table resource with its own name, across the app and its installed JSKIT packages", async () => {
  await withProject(TABLES, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), []);
    assert.equal(result.resources, 4);
    assert.match(formatDataAccessReport(result), /^JSKIT data access: 4 table resource\(s\), each table and name defined once; 0 system scope\(s\) and 0 infrastructure exception\(s\) listed for review\.$/u);
  });
});

test("the fields of an app table resource that its CRUD contracts never name are listed, as information", async () => {
  const noteResource = [
    "export const noteResource = defineTableResource({",
    "  name: \"notes\",",
    "  tableName: \"notes\",",
    "  ownership: \"workspace\",",
    "  schema: {",
    "    id: { type: \"id\", primary: true },",
    "    workspaceId: { type: \"id\", required: true },",
    "    title: { type: \"string\", required: true },",
    "    body: { type: \"string\", nullable: true },",
    "    internalNote: { type: \"string\", nullable: true },",
    "    secret: { type: \"string\", hidden: true },",
    "    createdAt: { type: \"dateTime\" }",
    "  }",
    "});",
    "export const draftResource = defineTableResource({ name: \"drafts\", tableName: \"drafts\", ownership: \"public\", schema: { text: { type: \"string\" } } });",
    "export const memoResource = defineTableResource({ name: \"memos\", tableName: \"memos\", ownership: \"public\", schema: { text: { type: \"string\" } } });",
    ""
  ].join("\n");
  await withProject({
    "packages/notes/src/shared/noteResource.js": noteResource,
    "packages/notes/src/shared/noteCrud.js": [
      "export const noteCrud = defineCrudContract(noteResource, {",
      "  namespace: \"notes\",",
      "  fields: { title: { output: \"required\", create: \"required\" } }",
      "});",
      "export const noteSummaryCrud = defineCrudContract(noteResource, { namespace: \"note-summaries\", fields: { body: { output: \"optional\" } } });",
      // A contract whose fields are not all written out leaves its resource unjudged.
      "export const draftCrud = defineCrudContract(draftResource, { namespace: \"drafts\", fields: { ...draftFields } });",
      ""
    ].join("\n")
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.equal(result.ok, true);
    assert.deepEqual(result.unnamedFields, [
      { file: "packages/notes/src/shared/noteResource.js", line: 1, name: "notes", fields: ["internalNote"] }
    ]);
    const report = formatDataAccessReport(result);
    assert.match(report, /^Fields no CRUD contract names \(1 table resource\(s\)\), so no API shows or accepts them; name one in a contract's fields to offer it \(data\/unnamed-fields; https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/guide\/framework\/data-access#layer-2-the-crud-surface\):$/mu);
    assert.match(report, /^ {2}packages\/notes\/src\/shared\/noteResource\.js:1 {2}notes: internalNote$/mu);
  });
});

test("a second table resource for a table, a repeated name and an unreadable one fail, naming both files", async () => {
  await withProject({
    ...TABLES,
    "packages/legacy/src/shared/legacyReceivalResource.js": "export const legacy = defineTableResource({ name: \"legacyReceivals\", tableName: \"receivals\" });\n",
    "packages/accounts/src/shared/accountUserResource.js": "export const accountUsers = defineTableResource({ name: \"users\", tableName: \"account_users\" });\n",
    "packages/reports/src/shared/reportResource.js": "export const reports = defineTableResource({ name: `${prefix}_reports`, tableName });\n"
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "node_modules/@jskit-ai/users-core/src/shared/userResource.js:1 data/one-resource-per-table",
      "packages/accounts/src/shared/accountUserResource.js:1 data/one-resource-per-table",
      "packages/legacy/src/shared/legacyReceivalResource.js:1 data/one-resource-per-table",
      "packages/receivals/src/shared/receivalResource.js:3 data/one-resource-per-table",
      "packages/reports/src/shared/reportResource.js:1 data/one-resource-per-table"
    ]);
    const report = formatDataAccessReport(result);
    assert.match(report, /^ {2}packages\/legacy\/src\/shared\/legacyReceivalResource\.js:1 {2}table "receivals" has another table resource at packages\/receivals\/src\/shared\/receivalResource\.js:3; a table has exactly one table resource, owned by one feature\.$/mu);
    assert.match(report, /^ {2}packages\/receivals\/src\/shared\/receivalResource\.js:3 {2}table "receivals" has another table resource at packages\/legacy\/src\/shared\/legacyReceivalResource\.js:1;/mu);
    assert.match(report, /^ {2}node_modules\/@jskit-ai\/users-core\/src\/shared\/userResource\.js:1 {2}resource name "users" is also the name of the table resource at packages\/accounts\/src\/shared\/accountUserResource\.js:1; every table resource has its own name\.$/mu);
    assert.match(report, /reportResource\.js:1 {2}defineTableResource\(\) does not write its name and tableName as string literals/u);
    assert.match(report, /^data\/one-resource-per-table \(5\): every table has exactly one table resource, under a name no other resource has\. https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/guide\/framework\/data-access#layer-1-the-table-resource$/mu);
    assert.equal(report.match(/every table has exactly one table resource/gu).length, 1);
    assert.match(report, /^JSKIT data access: 5 error\(s\)\./mu);
  });
});

const SCOPES = Object.freeze({
  "packages/leagues/src/server/LeagueSettlementFeature.js": [
    "export const SettlementFeature = defineFeature({",
    "  id: \"leagues.settlement\",",
    "  owns: [cohortResource, memberResource],",
    "  systemScope: \"settle finished weekly leagues for every user\",",
    "  setup: ({ resources, systemContext }) => ({ service: createSettlement(resources, systemContext) })",
    "});",
    ""
  ].join("\n"),
  "packages/leagues/src/server/settlement.js": [
    "const REASON = \"settle one finished league\";",
    "export function createSettlement(resources, systemContext) {",
    "  return async () => {",
    "    const system = { context: systemContext(\"settle finished weekly leagues for every user\") };",
    "    const unit = systemContext(REASON).forWorkspace(1);",
    "    return [system, unit, \"systemContext(why) in a string calls nothing\"];",
    "  };",
    "}",
    ""
  ].join("\n"),
  "packages/console/src/server/ConsoleReportsFeature.js": "export const ConsoleReportsFeature = defineCrudFeature({ crud: reportCrud, systemScope: 'console reports across all users' });\n",
  "node_modules/@jskit-ai/kernel/package.json": { name: "@jskit-ai/kernel", version: "0.1.0" },
  "node_modules/@jskit-ai/kernel/server/defineFeature.js": [
    "function defineFeature(definition) {",
    "  return Object.freeze({ ...definition, systemScope: definition.systemScope });",
    "}",
    "export { defineFeature };",
    ""
  ].join("\n"),
  "node_modules/@jskit-ai/crud-core/src/server/defineCrudFeature.js":
    "export function defineCrudFeature(config) { return defineFeature({ id: config.id, systemScope: config.systemScope }); }\n",
  "node_modules/@jskit-ai/resource-runtime/src/server/systemContext.js": [
    "function systemContext(reason) { return createSystemContext(reason); }",
    "const contexts = { systemContext(reason) { return systemContext(reason); } };",
    "export const sweep = () => systemContext(\"delete expired sessions of every user\");",
    ""
  ].join("\n"),
  // The reviewed scopes of the app's own features.
  "jskit-data-access.json": {
    infrastructure: [],
    systemScopes: [
      { feature: "leagues.settlement", systemScope: "settle finished weekly leagues for every user" },
      { feature: "", systemScope: "console reports across all users" }
    ]
  }
});

test("every system scope is listed with its reason: feature declarations and systemContext() calls", async () => {
  await withProject(SCOPES, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), []);
    assert.deepEqual(result.systemScopes.map(({ file, line, kind, id, reason }) => `${file}:${line} ${kind} ${id} ${reason}`), [
      "packages/console/src/server/ConsoleReportsFeature.js:1 feature  console reports across all users",
      "packages/leagues/src/server/LeagueSettlementFeature.js:1 feature leagues.settlement settle finished weekly leagues for every user",
      "packages/leagues/src/server/settlement.js:4 call  settle finished weekly leagues for every user",
      "packages/leagues/src/server/settlement.js:5 call  settle one finished league",
      "node_modules/@jskit-ai/resource-runtime/src/server/systemContext.js:3 call  delete expired sessions of every user"
    ]);
    const report = formatDataAccessReport(result);
    assert.match(report, /^System scopes \(5\), each reading past ownership for its reason \(data\/system-scope; https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/guide\/framework\/data-access#background-work\):$/mu);
    assert.match(report, /^ {2}packages\/leagues\/src\/server\/LeagueSettlementFeature\.js:1 {2}feature leagues\.settlement {2}"settle finished weekly leagues for every user"$/mu);
    assert.match(report, /^ {2}packages\/console\/src\/server\/ConsoleReportsFeature\.js:1 {2}feature \(no id\) {2}"console reports across all users"$/mu);
    assert.match(report, /^ {2}packages\/leagues\/src\/server\/settlement\.js:5 {2}systemContext\(\) {2}"settle one finished league"$/mu);
    assert.match(report, /; 5 system scope\(s\) and 0 infrastructure exception\(s\) listed for review\.$/u);
  });
});

test("a system scope without a literal reason fails, in the app and as an empty reason anywhere", async () => {
  await withProject({
    ...SCOPES,
    "packages/jobs/src/server/CleanupFeature.js": [
      "export const CleanupFeature = defineFeature({ id: \"jobs.cleanup\", systemScope: \"\" });",
      "export const NightlyFeature = defineFeature({ id: \"jobs.nightly\", systemScope: reasonFor(\"nightly\") });",
      "export const run = (systemContext, why) => [systemContext(), systemContext(why), systemContext(\"  \")];",
      ""
    ].join("\n"),
    "node_modules/@jskit-ai/auth-core/src/server/sessions.js": "export const expire = (systemContext) => systemContext(\"\");\n"
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "node_modules/@jskit-ai/auth-core/src/server/sessions.js:1 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:1 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:2 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:3 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:3 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:3 data/system-scope"
    ]);
    const messages = result.findings.map(({ message }) => message);
    assert.ok(messages.includes("systemScope gives no reason; say why this feature reads past ownership."));
    assert.ok(messages.includes("systemScope is not a string literal; write the reason this feature reads past ownership where it is declared."));
    assert.ok(messages.includes("systemContext() does not take its reason as a string literal; write why this call reads past ownership at the call."));
    assert.equal(messages.filter((message) => message === "systemContext() gives no reason; say why this call reads past ownership.").length, 3);
  });
});

test("the files the infrastructure exception lifts past the lint rules are listed for review, not failed", async () => {
  await withProject({
    "server/lib/migrate.js": [
      "#!/usr/bin/env node",
      "// readable-check: allow no-direct-knex - infrastructure: the migration runner keeps its own bookkeeping table",
      "/* readable-check: allow jskit/no-transaction-reader - infrastructure: the migration runner's own transaction */",
      "import knexFactory from \"knex\";",
      "// readable-check: allow no-direct-knex - infrastructure: below the first line of code, so it excuses nothing",
      ""
    ].join("\n"),
    "packages/notes/src/server/notes.js": "// readable-check: allow method-probe - data: a note may lack a body\nexport const body = (note) => note.body;\n",
    "node_modules/@jskit-ai/oidc-issuer-core/src/server/store.js": "// readable-check: allow no-direct-knex - infrastructure: protocol state of the issuer\nexport const store = {};\n",
    "jskit-data-access.json": {
      infrastructure: [{ file: "server/lib/migrate.js", rule: "no-direct-knex" }, { file: "server/lib/migrate.js", rule: "no-transaction-reader" }],
      systemScopes: []
    }
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.equal(result.ok, true);
    assert.deepEqual(result.excuses.map(({ file, line, rule, reason }) => `${file}:${line} ${rule} ${reason}`), [
      "server/lib/migrate.js:2 no-direct-knex infrastructure: the migration runner keeps its own bookkeeping table",
      "server/lib/migrate.js:3 no-transaction-reader infrastructure: the migration runner's own transaction"
    ]);
    const report = formatDataAccessReport(result);
    assert.match(report, /^Infrastructure exceptions \(2\), each a whole file past a data-access lint rule \(data\/infrastructure-excuses; https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/guide\/framework\/data-access#hard-rules\):$/mu);
    assert.match(report, /^ {2}server\/lib\/migrate\.js:2 {2}no-direct-knex {2}infrastructure: the migration runner keeps its own bookkeeping table$/mu);
    assert.match(report, /; 0 system scope\(s\) and 2 infrastructure exception\(s\) listed for review\.$/u);
  });
});

test("a new exception or system scope fails until the baseline lists it, as do runtime capabilities and data-access disables", async () => {
  await withProject({
    "server/lib/health.js": "// readable-check: allow no-direct-knex - infrastructure: the health check's ping\nexport const ping = ({ database }) => database;\n",
    "packages/jobs/src/server/CleanupFeature.js": "export const CleanupFeature = defineFeature({ id: \"jobs.cleanup\", systemScope: \"delete expired drafts of every user\" });\n",
    "packages/jobs/src/server/RawProvider.js": [
      "export const RawProvider = defineProvider({",
      "  id: \"jobs.raw\",",
      "  requires: { database: \"runtime.database\", resources: 'runtime.resources' },",
      "  setup: ({ database }) => ({})",
      "});",
      ""
    ].join("\n"),
    "packages/jobs/src/server/report.js": [
      "// eslint-disable-next-line jskit/no-direct-knex -- a quick report",
      "export const report = (knex) => knex(\"drafts\");",
      "/* eslint-disable */",
      "// eslint-disable-next-line no-control-regex -- strips control characters",
      "export const clean = (text) => text;",
      ""
    ].join("\n"),
    "src/pages/drafts.js": "/* eslint-disable */\nexport const page = {};\n",
    "server/lib/databaseProvider.js": "export const DatabaseProvider = defineProvider({ provides: { database: \"runtime.database\" } });\n",
    "node_modules/@jskit-ai/database-runtime/package.json": { name: "@jskit-ai/database-runtime", version: "0.1.0" },
    "node_modules/@jskit-ai/database-runtime/src/server/DatabaseProvider.js": "export const provides = { database: \"runtime.database\" };\n// eslint-disable\n",
    "jskit-data-access.json": { infrastructure: [{ file: "server/lib/old.js", rule: "no-direct-knex" }], systemScopes: [] }
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "packages/jobs/src/server/CleanupFeature.js:1 data/baseline",
      "packages/jobs/src/server/RawProvider.js:3 data/runtime-capability",
      "packages/jobs/src/server/RawProvider.js:3 data/runtime-capability",
      "packages/jobs/src/server/report.js:1 data/lint-disabled",
      "packages/jobs/src/server/report.js:3 data/lint-disabled",
      "server/lib/health.js:1 data/baseline"
    ]);
    const messages = result.findings.map(({ message }) => message);
    assert.ok(messages.includes("the infrastructure exception from no-direct-knex: once the whole module's job is data access, add {\"file\":\"server/lib/health.js\",\"rule\":\"no-direct-knex\"} to \"infrastructure\"."));
    assert.ok(messages.some((message) => message.startsWith("the system scope of feature \"jobs.cleanup\": once it must work across every workspace and user, add")));
    assert.deepEqual(messages.filter((message) => message.startsWith("requires ")), ["requires runtime.database", "requires runtime.resources"]);
    assert.ok(messages.includes("eslint-disable turns off jskit/no-direct-knex"));
    assert.ok(messages.includes("eslint-disable names no rule"));
    // Each rule's explanation is said once, above its findings.
    const report = formatDataAccessReport(result);
    assert.match(report, /^data\/runtime-capability \(2\): a module that requires runtime\.database or runtime\.resources reaches tables past the features that own them\./mu);
    assert.match(report, /^ {2}packages\/jobs\/src\/server\/RawProvider\.js:3 {2}requires runtime\.database$/mu);
    assert.equal(report.match(/reaches tables past the features that own them/gu).length, 1);
  });
  await withProject({ "jskit-data-access.json": "{ not json" }, async (root) => {
    assert.deepEqual(findingLines(await checkDataAccess({ projectRoot: root })), ["jskit-data-access.json:1 data/baseline"]);
  });
});

test("plain jskit check reports the data rules and fails on a second table resource for a table", async () => {
  const app = {
    "package.json": { name: "tables", scripts: { test: "jskit test" } },
    "package-lock.json": { name: "tables", lockfileVersion: 3, packages: { "": { name: "tables" } } },
    "packages/receivals/src/shared/receivalResource.js": "export const receivals = defineTableResource({ name: \"receivals\", tableName: \"receivals\" });\n"
  };
  await withProject(app, async (root) => {
    const { stdout } = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]);
    assert.match(stdout, /^JSKIT data access: 1 table resource\(s\), each table and name defined once;/mu);
  });
  await withProject({
    ...app,
    "packages/archive/src/shared/archivedReceivalResource.js": "export const archived = defineTableResource({ name: \"archivedReceivals\", tableName: \"receivals\" });\n"
  }, async (root) => {
    const failure = await execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]).then(() => null, (error) => error);
    assert.equal(failure?.code, 1);
    assert.match(failure.stderr, /^ {2}packages\/archive\/src\/shared\/archivedReceivalResource\.js:1 {2}table "receivals" has another table resource at packages\/receivals\/src\/shared\/receivalResource\.js:1;/mu);
  });
});
