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

test("a lookup's or a CRUD list screen's app table resource without searchSchema.q fails; q on the resource or its owns entry passes", async () => {
  const table = (variable, name, extra = "") =>
    `export const ${variable} = defineTableResource({ name: "${name}", tableName: "${name}", ownership: "workspace", schema: { name: { type: "string" } }${extra} });`;
  await withProject({
    "packages/customers/src/shared/customerResource.js": [
      table("customerResource", "customers"),
      "export const customerCrud = defineCrudContract(customerResource, { namespace: \"customers\", fields: { name: { output: \"required\" } } });",
      ""
    ].join("\n"),
    "packages/suppliers/src/shared/supplierResource.js": [
      table("supplierResource", "suppliers"),
      table("lotResource", "processingLots"),
      ""
    ].join("\n"),
    // q given by the owns entry, not the resource.
    "packages/suppliers/src/server/feature.js":
      "export const feature = defineCrudFeature({ owns: [{ resource: supplierResource, searchSchema: { q: { type: \"string\", oneOf: [\"name\"] } } }] });\n",
    "packages/orders/src/shared/orderResource.js": [
      "export const orderResource = defineTableResource({",
      "  name: \"orders\",",
      "  tableName: \"orders\",",
      "  schema: {",
      "    customerId: { type: \"id\", lookup: \"customers\" },",
      "    supplierId: { type: \"id\", lookup: \"suppliers\" },",
      "    lotId: { type: \"id\", relation: { kind: \"lookup\", namespace: \"processing-lots\" } },",
      "    ownerId: { type: \"id\", lookup: \"users\" }",
      "  },",
      "  searchSchema: { q: { type: \"string\", oneOf: [\"reference\"] } }",
      "});",
      "export const orderCrud = defineCrudContract(orderResource, { namespace: \"orders\", fields: { customerId: { output: \"required\" } } });",
      ""
    ].join("\n"),
    "src/pages/customers/index.vue": [
      "<script setup>",
      "import { customerCrud } from \"@local/customers/shared\";",
      "const screen = useCrudListScreen({ resource: customerCrud, apiSuffix: \"/customers\" });",
      "</script>",
      "<template><p>Don't search here.</p><CrudListScreen :screen=\"screen\" /></template>",
      ""
    ].join("\n"),
    "src/pages/orders/index.vue": "<script setup>\nconst screen = useCrudListScreen({ resource: orderCrud });\n</script>\n",
    // A framework resource is left to its package.
    "node_modules/@jskit-ai/users-core/package.json": { name: "@jskit-ai/users-core", version: "0.1.0" },
    "node_modules/@jskit-ai/users-core/src/shared/userResource.js": "export const userResource = defineTableResource({ name: \"users\", tableName: \"users\", ownership: \"user\" });\n"
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "packages/orders/src/shared/orderResource.js:5 data/search-q",
      "packages/orders/src/shared/orderResource.js:7 data/search-q",
      "src/pages/customers/index.vue:3 data/search-q"
    ]);
    const report = formatDataAccessReport(result);
    assert.match(report, /^data\/search-q \(3\): a lookup field's picker and a CRUD list screen's Search box send what the person types as q, .* https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/guide\/framework\/data-access#narrow-in-the-query$/mu);
    assert.match(report, /orderResource\.js:5 {2}lookup "customers" picks from customers \(packages\/customers\/src\/shared\/customerResource\.js:1\), which defines no searchSchema\.q/u);
    assert.match(report, /orderResource\.js:7 {2}lookup "processing-lots" picks from processingLots /u);
    assert.match(report, /index\.vue:3 {2}this list screen shows customerCrud, whose table resource customers .* Search box/u);
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
  "node_modules/@jskit-ai/auth-core/src/server/sweep.js": [
    "const contexts = { systemContext(reason) { return reason; } };",
    "export const sweep = (systemContext) => systemContext(\"delete expired sessions of every user\");",
    ""
  ].join("\n"),
  // Functions of the app's own that are merely named systemContext: declared in the file, or handed in typed as
  // something else. Their calls are not JSKIT's, so they are neither listed nor failed.
  "packages/graph/src/server/service.js": [
    "async function systemContext(sessionId = \"\") { return { sessionId }; }",
    "export const read = async (input) => [await systemContext(input.sessionId), await systemContext()];",
    ""
  ].join("\n"),
  "packages/deployments/src/server/hostnames.js": [
    "/**",
    " * @param {object} dependencies",
    " * @param {() => { systemRoot: string }} dependencies.systemContext",
    " */",
    "export function createHostnames({ systemContext }) {",
    "  return { route: (input) => resolve(systemContext(), input) };",
    "}",
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
      "node_modules/@jskit-ai/auth-core/src/server/sweep.js:2 call  delete expired sessions of every user"
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
    "node_modules/@jskit-ai/auth-core/src/server/sessions.js": "export const expire = (systemContext) => systemContext(\"\");\n",
    // Typed as JSKIT's factory, the binding is JSKIT's, so its call needs a reason.
    "packages/jobs/src/server/reminders.js": [
      "/**",
      " * @param {object} dependencies",
      " * @param {(reason: string) => import(\"@jskit-ai/resource-runtime/server/types\").SystemContext} dependencies.systemContext",
      " */",
      "export const createReminders = ({ systemContext }) => () => systemContext();",
      ""
    ].join("\n")
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "node_modules/@jskit-ai/auth-core/src/server/sessions.js:1 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:1 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:2 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:3 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:3 data/system-scope",
      "packages/jobs/src/server/CleanupFeature.js:3 data/system-scope",
      "packages/jobs/src/server/reminders.js:5 data/system-scope"
    ]);
    const messages = result.findings.map(({ message }) => message);
    assert.ok(messages.includes("systemScope gives no reason; say why this feature reads past ownership."));
    assert.ok(messages.includes("systemScope is not a string literal; write the reason this feature reads past ownership where it is declared."));
    assert.ok(messages.includes("systemContext() does not take its reason as a string literal; write why this call reads past ownership at the call."));
    assert.equal(messages.filter((message) => message === "systemContext() gives no reason; say why this call reads past ownership.").length, 4);
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
    "data_import/stages/pets.js": "// readable-check: allow no-hand-scope - infrastructure: the operator's cutover import, which names each workspace it loads\nexport const stage = {};\n",
    "jskit-data-access.json": {
      infrastructure: [
        { file: "server/lib/migrate.js", rule: "no-direct-knex" },
        { file: "server/lib/migrate.js", rule: "no-transaction-reader" },
        { file: "data_import/stages/pets.js", rule: "no-hand-scope" }
      ],
      systemScopes: []
    }
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.equal(result.ok, true);
    assert.deepEqual(result.excuses.map(({ file, line, rule, reason }) => `${file}:${line} ${rule} ${reason}`).sort(), [
      "data_import/stages/pets.js:1 no-hand-scope infrastructure: the operator's cutover import, which names each workspace it loads",
      "server/lib/migrate.js:2 no-direct-knex infrastructure: the migration runner keeps its own bookkeeping table",
      "server/lib/migrate.js:3 no-transaction-reader infrastructure: the migration runner's own transaction"
    ]);
    const report = formatDataAccessReport(result);
    assert.match(report, /^Infrastructure exceptions \(3\), each a whole file past a data-access lint rule \(data\/infrastructure-excuses; https:\/\/mobily-enterprises\.github\.io\/jskit-ai\/guide\/framework\/data-access#hard-rules\):$/mu);
    assert.match(report, /^ {2}server\/lib\/migrate\.js:2 {2}no-direct-knex {2}infrastructure: the migration runner keeps its own bookkeeping table$/mu);
    assert.match(report, /; 0 system scope\(s\) and 3 infrastructure exception\(s\) listed for review\.$/u);
  });
});

test("a new exception or system scope fails until the baseline lists it, as do runtime capabilities and data-access disables", async () => {
  await withProject({
    "server/lib/health.js": "// readable-check: allow no-direct-knex - infrastructure: the health check's ping\nexport const ping = ({ database }) => database;\n",
    "packages/jobs/src/server/CleanupFeature.js": "export const CleanupFeature = defineFeature({ id: \"jobs.cleanup\", systemScope: \"delete expired drafts of every user\" });\n",
    // Capability ids are read as the kernel resolves them: trimmed and in any case.
    "packages/jobs/src/server/RawProvider.js": [
      "export const RawProvider = defineProvider({",
      "  id: \"jobs.raw\",",
      "  requires: { database: \"runtime.database\", resources: 'Runtime.Resources ' },",
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
      "/* eslint jskit/no-direct-knex: \"off\", no-console: 0 */",
      "/* eslint no-console: \"off\" */",
      "// A line comment quoting /* eslint jskit/sql-literal: 0 */ sets nothing, nor does a string:",
      "export const text = \"/* eslint jskit/sql-literal: 0 */\";",
      ""
    ].join("\n"),
    // The capabilities that hand out power past the owners: each one a module requires is reviewed in systemScopes,
    // with its reason; a feature's own id and a provides entry require nothing.
    "packages/portal/src/server/PortalFeature.js": [
      "export const PortalFeature = defineFeature({",
      "  id: \"portal.customers\",",
      "  requires: { accounts: \"auth.local.accounts\", sessions: \"auth.local.sessions\" },",
      "  optional: { audienceScope: \"Realtime.Audience-Scope\" },",
      "  setup: () => ({})",
      "});",
      ""
    ].join("\n"),
    "packages/portal/src/server/AudienceScopeFeature.js": "export const AudienceScopeFeature = defineFeature({ id: \"realtime.audience-scope\", provides: { audienceScope: \"realtime.audience-scope\" } });\n",
    // An app's own src/ is linted whole, so a disable there turns the rules off as anywhere; a package's client is left alone.
    "src/pages/drafts.js": "/* eslint-disable */\nexport const page = {};\n",
    "packages/drafts/src/client/page.js": "/* eslint-disable */\nexport const page = {};\n",
    "server/lib/databaseProvider.js": "export const DatabaseProvider = defineProvider({ provides: { database: \"runtime.database\" } });\n",
    "node_modules/@jskit-ai/database-runtime/package.json": { name: "@jskit-ai/database-runtime", version: "0.1.0" },
    "node_modules/@jskit-ai/database-runtime/src/server/DatabaseProvider.js": "export const provides = { database: \"runtime.database\" };\n// eslint-disable\n",
    "jskit-data-access.json": {
      infrastructure: [{ file: "server/lib/old.js", rule: "no-direct-knex" }],
      systemScopes: [
        { file: "packages/portal/src/server/PortalFeature.js", capability: "auth.local.sessions", systemScope: "sign a customer in by an emailed link" },
        { file: "packages/portal/src/server/PortalFeature.js", capability: "auth.local.accounts", systemScope: " " }
      ]
    }
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "packages/jobs/src/server/CleanupFeature.js:1 data/baseline",
      "packages/jobs/src/server/RawProvider.js:3 data/runtime-capability",
      "packages/jobs/src/server/RawProvider.js:3 data/runtime-capability",
      "packages/jobs/src/server/report.js:1 data/lint-disabled",
      "packages/jobs/src/server/report.js:3 data/lint-disabled",
      "packages/jobs/src/server/report.js:6 data/lint-disabled",
      "packages/portal/src/server/PortalFeature.js:3 data/runtime-capability",
      "packages/portal/src/server/PortalFeature.js:4 data/runtime-capability",
      "server/lib/health.js:1 data/baseline",
      "src/pages/drafts.js:1 data/lint-disabled"
    ]);
    const messages = result.findings.map(({ message }) => message);
    assert.ok(messages.includes("the infrastructure exception from no-direct-knex: once the whole module's job is data access, add {\"file\":\"server/lib/health.js\",\"rule\":\"no-direct-knex\"} to \"infrastructure\"."));
    assert.ok(messages.some((message) => message.startsWith("the system scope of feature \"jobs.cleanup\": once it must work across every workspace and user, add")));
    assert.deepEqual(messages.filter((message) => message.startsWith("requires ")).map((message) => message.split(",")[0]), [
      "requires runtime.database",
      "requires runtime.resources",
      "requires auth.local.accounts",
      "requires realtime.audience-scope"
    ]);
    assert.ok(messages.includes("requires auth.local.accounts, which gives every local sign-in account, read and written in local auth's system context: " +
      "once the module must, add {\"file\":\"packages/portal/src/server/PortalFeature.js\",\"capability\":\"auth.local.accounts\",\"systemScope\":\"<why it needs this>\"} to \"systemScopes\"."));
    assert.ok(messages.includes("eslint-disable turns off jskit/no-direct-knex"));
    assert.ok(messages.includes("eslint-disable names no rule"));
    assert.ok(messages.includes("an inline eslint config sets jskit/no-direct-knex"));
    // Each rule's explanation is said once, above its findings.
    const report = formatDataAccessReport(result);
    assert.match(report, /^data\/runtime-capability \(4\): a module that requires a capability handing out power past the owners reaches rows past the features that own them\./mu);
    assert.match(report, /^ {2}packages\/jobs\/src\/server\/RawProvider\.js:3 {2}requires runtime\.database$/mu);
    assert.equal(report.match(/reaches rows past the features that own them/gu).length, 1);
  });
  await withProject({ "jskit-data-access.json": "{ not json" }, async (root) => {
    assert.deepEqual(findingLines(await checkDataAccess({ projectRoot: root })), ["jskit-data-access.json:1 data/baseline"]);
  });
});

test("the stores of connectors, the assistant and payments hand out power past the owners; a feature's id passes only when it provides it", async () => {
  await withProject({
    "packages/sync/src/server/SyncFeature.js": [
      "export const SyncFeature = defineFeature({",
      "  id: \"sync.jobs\",",
      "  requires: { connections: \"connectors.store\", assistant: \"assistant.repositories\", payments: \"payments.store\" },",
      "  setup: () => ({})",
      "});",
      ""
    ].join("\n"),
    // A feature named as a capability it does not provide requires it like any other module.
    "packages/sync/src/server/PaymentsMirrorFeature.js": "export const PaymentsMirrorFeature = defineFeature({ id: \"payments.store\", provides: { mirror: \"sync.mirror\" } });\n",
    "packages/sync/src/server/PaymentStoreFeature.js": "export const PaymentStoreFeature = defineFeature({ id: \"payments.store\", provides: { store: \"payments.store\" } });\n",
    // A migrations or test folder is skipped only at the root of the app or of a package: deeper, it is server code.
    "packages/sync/src/server/migrations/backfill.js": "export const requires = { store: \"connectors.store\" };\n",
    "packages/sync/migrations/20260101_sync.js": "export const requires = { store: \"connectors.store\" };\n",
    "packages/sync/src/test/fixtures.js": "export const requires = { store: \"connectors.store\" };\n",
    "tests/fixtures/store.js": "export const requires = { store: \"connectors.store\" };\n"
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "packages/sync/src/server/migrations/backfill.js:1 data/runtime-capability",
      "packages/sync/src/server/PaymentsMirrorFeature.js:1 data/runtime-capability",
      "packages/sync/src/server/SyncFeature.js:3 data/runtime-capability",
      "packages/sync/src/server/SyncFeature.js:3 data/runtime-capability",
      "packages/sync/src/server/SyncFeature.js:3 data/runtime-capability"
    ]);
    assert.deepEqual(result.findings.filter(({ file }) => file.endsWith("SyncFeature.js")).map(({ message }) => message.split(":")[0]), [
      "requires connectors.store, which gives every owner's connections, with their credentials decrypted",
      "requires assistant.repositories, which gives every actor's and workspace's assistant conversations, messages and settings",
      "requires payments.store, which gives every merchant's payment accounts, customers and catalogues"
    ]);
  });
});

test("an app file its ESLint config lints without every data-access rule as an error fails, as does server code it ignores", async () => {
  const dataAccess = JSON.stringify(new URL("../../config-eslint/dataAccess.js", import.meta.url).href);
  await withProject({
    "package.json": { name: "linted", type: "module" },
    "eslint.config.mjs": [
      `import { dataAccessConfig } from ${dataAccess};`,
      "export default [",
      "  { ignores: [\"packages/billing/src/server/**\", \"public/**\"] },",
      "  ...dataAccessConfig([\"**\"]),",
      "  { files: [\"server/lib/report.js\", \"server/lib/legacy.js\"], rules: { \"jskit/no-direct-knex\": \"off\" } },",
      "  { files: [\"server/lib/report.js\"], rules: { \"jskit/sql-literal\": \"warn\" } },",
      "  ...dataAccessConfig([\"server/jobs/**\"], \"off\")",
      "];",
      ""
    ].join("\n"),
    "server/lib/report.js": "export const report = {};\n",
    "server/lib/legacy.js": "export const legacy = {};\n",
    "server/lib/health.js": "export const health = {};\n",
    "server/jobs/cleanup.js": "export const cleanup = {};\n",
    "packages/billing/src/server/invoices.js": "export const invoices = {};\n",
    // Ignored code that is not server code, client code and seed scripts are the rules' to leave alone.
    "public/vendor/chart.js": "export const chart = {};\n",
    "packages/billing/src/client/useInvoices.js": "export const useInvoices = {};\n",
    "scripts/seed-demo.js": "export const seed = {};\n",
    // A nested application is judged by its own config, and what the rules leave alone is told from its root.
    "vendor/editor/eslint.config.mjs": [
      `import { dataAccessConfig } from ${dataAccess};`,
      "export default [...dataAccessConfig([\"**\"]), { files: [\"server/legacy.js\"], rules: { \"jskit/knex-reason\": \"off\" } }];",
      ""
    ].join("\n"),
    "vendor/editor/packages/main/src/client/index.js": "export const main = {};\n",
    "vendor/editor/tests/fixtures/app.js": "export const app = {};\n",
    "vendor/editor/server/legacy.js": "export const legacy = {};\n",
    // A module whose whole job is data access is listed for the rule its config turns off.
    "jskit-data-access.json": { infrastructure: [{ file: "server/lib/legacy.js", rule: "no-direct-knex" }], systemScopes: [] }
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(result.findings.map(({ file, line, rule, message }) => `${file}:${line} ${rule} ${message}`), [
      "packages/billing/src/server/invoices.js:1 data/lint-config the ESLint config ignores this server file, so no data-access rule checks it",
      "server/jobs/cleanup.js:1 data/lint-config the ESLint config does not make jskit/no-direct-knex, jskit/no-transaction-reader, " +
        "jskit/sql-literal, jskit/no-hand-scope, jskit/no-hand-context, jskit/knex-reason an error here",
      "server/lib/report.js:1 data/lint-config the ESLint config does not make jskit/no-direct-knex, jskit/sql-literal an error here",
      "vendor/editor/server/legacy.js:1 data/lint-config the ESLint config does not make jskit/knex-reason an error here"
    ]);
    assert.match(formatDataAccessReport(result), /^data\/lint-config \(4\): the app's ESLint config makes every data-access rule an error in each server file/mu);
  });
});

test("code the app's ESLint config ignores outside server code is skipped, and listed", async () => {
  const dataAccess = JSON.stringify(new URL("../../config-eslint/dataAccess.js", import.meta.url).href);
  const widgets = "defineTableResource({ name: \"widgets\", tableName: \"widgets\", ownership: \"workspace\" });";
  await withProject({
    "package.json": { name: "vendored", type: "module" },
    "eslint.config.mjs": [
      `import { dataAccessConfig } from ${dataAccess};`,
      "export default [{ ignores: [\"legacy/\", \"public/vendor/\"] }, ...dataAccessConfig([\"**\"])];",
      ""
    ].join("\n"),
    "packages/widgets/src/shared/widgetResource.js": `export const widgetResource = ${widgets}\n`,
    "server/index.js": "export const index = {};\n",
    "scripts/build.js": "export const build = {};\n",
    // A read-only legacy copy, kept beside the app, that no lint reads: none of it is held to the data rules either.
    "legacy/server/db.js": `/* eslint-disable */\nexport const widgets = ${widgets}\n`,
    "legacy/lib/report.js": "export const report = () => systemContext(\"\"); // eslint-disable-line\n",
    "public/vendor/chart.js": "/* eslint-disable */\nexport const requires = { database: \"runtime.database\" };\n"
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), []);
    assert.deepEqual(result.skipped, ["legacy/", "public/"]);
    assert.match(formatDataAccessReport(result),
      /^Skipped, as the app's ESLint config ignores them and they hold no server code \(2\):\n {2}legacy\/\n {2}public\/\nJSKIT data access: 1 table resource\(s\)/mu);
  });
});

test("server code the app's ESLint config ignores is still read, and fails", async () => {
  const dataAccess = JSON.stringify(new URL("../../config-eslint/dataAccess.js", import.meta.url).href);
  await withProject({
    "package.json": { name: "unlinted", type: "module" },
    "eslint.config.mjs": [
      `import { dataAccessConfig } from ${dataAccess};`,
      "export default [",
      "  { ignores: [\"server.js\", \"server/\", \"scripts/vendored-*.js\", \"config/\", \"src/jobs/\", \"packages/*/bin/\"] },",
      "  ...dataAccessConfig([\"**\"])",
      "];",
      ""
    ].join("\n"),
    // Server code, as the base config lints it: a root's files and its src/, server/, scripts/, bin/ and config/.
    "server.js": "export const server = {};\n",
    "server/lib/db.js": "/* eslint-disable */\nexport const db = {};\n",
    "scripts/vendored-tool.js": "/* eslint-disable */\nexport const requires = { database: \"runtime.database\" };\n",
    "config/database.js": "export const database = {};\n",
    "src/jobs/cleanup.js": "export const cleanup = {};\n",
    "packages/billing/bin/import.js": "export const run = {};\n"
  }, async (root) => {
    const result = await checkDataAccess({ projectRoot: root });
    assert.deepEqual(findingLines(result), [
      "config/database.js:1 data/lint-config",
      "packages/billing/bin/import.js:1 data/lint-config",
      "scripts/vendored-tool.js:1 data/lint-disabled",
      "scripts/vendored-tool.js:1 data/lint-config",
      "scripts/vendored-tool.js:2 data/runtime-capability",
      "server.js:1 data/lint-config",
      "server/lib/db.js:1 data/lint-disabled",
      "server/lib/db.js:1 data/lint-config",
      "src/jobs/cleanup.js:1 data/lint-config"
    ]);
    assert.deepEqual(result.skipped, []);
    assert.doesNotMatch(formatDataAccessReport(result), /^Skipped/mu);
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
