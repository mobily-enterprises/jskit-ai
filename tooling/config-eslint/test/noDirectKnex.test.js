import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noDirectKnex } from "../plugin/rules/noDirectKnex.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const EXCUSE = "// readable-check: allow no-direct-knex - infrastructure: the migration runner keeps its own bookkeeping table";

new RuleTester().run("jskit/no-direct-knex", noDirectKnex, {
  valid: [
    "async function listOpen(options) { return receivals.query({ filters: { status: \"open\" }, page: { size: 20 } }, options); }",
    "const connection = knex({ client: \"mysql2\", connection: settings });",
    "const pending = lots.scopedQuery(options).select(\"id\");\nquery.whereIn(\"lotId\", pending);",
    "query.join(events.scopedQuery(options).as(\"e\"), \"e.receivalId\", \"r.id\");",
    "const recent = events.scopedQuery(options).as(\"e\");\nquery.leftJoin(recent, \"e.receivalId\", \"r.id\");",
    "query.from(receivals.scopedQuery(options).as(\"r\"));",
    "repository.withTransaction(options, (tx) => receivals.create(row, tx));",
    "const bytes = Buffer.from(\"text\", \"utf8\");\nconst letters = Array.from(\"abc\");",
    "const file = path.join(\"migrations\", name);\nconst other = nodePath.posix.join(\"a\", \"b\");",
    "const label = names.join(\", \");\nconsole.table(\"rows\");",
    // A template or a concatenation outside a table's place: an array's join, a static from, a path, a subquery's alias.
    "const line = cells.join(`${separator} `);\nconst chars = Array.from(`${word}!`);\nconst file = path.join(`${root}/data`, name);",
    "query.join(events.scopedQuery(options).as(`e_${index}`), `e_${index}.receivalId`, \"r.id\");\nconst title = \"Lot \" + number;",
    "runtime.knex = connection;",
    "const reply = await client(model);\nconst draft = transaction(saved);\nconst view = db(record).view;",
    `${EXCUSE}\nimport { readFile } from "node:fs/promises";\nexport const applied = (knex) => knex("knex_migrations").select("name");`,
    "/* readable-check: allow jskit/no-direct-knex - infrastructure: the database template copier */\nexport const copy = (database) => database.knex.raw(\"select 1\");"
  ],
  invalid: [
    {
      code: "const { knex: q } = database;\nfunction open({ knex }) { return knex; }",
      errors: [{ messageId: "knexDestructured", data: { text: "knex: q" }, line: 1 }, { messageId: "knexDestructured", data: { text: "knex" }, line: 2 }]
    },
    {
      code: "const users = await knex(\"users\").where({ id });",
      errors: [{ messageId: "tableBuilder", data: { text: "knex" } }]
    },
    {
      code: "const rows = await (options.trx || knex)(\"receivals\").select(\"id\");",
      errors: [{ messageId: "tableBuilder" }]
    },
    {
      code: "await trx(`audit_events`).insert(row);\nawait db(\"pets\").del();\nawait client(\"rooms\").select();\nawait tx(\"lots\").select();",
      errors: [{ messageId: "tableBuilder", line: 1 }, { messageId: "tableBuilder", line: 2 }, { messageId: "tableBuilder", line: 3 }, { messageId: "tableBuilder", line: 4 }]
    },
    {
      code: "await knex(tables.messages).where({ id });\nawait trx(table).insert(row);\nawait knex(`${prefix}_rows`).select();\nawait client(MODELS_TABLE).del();\nawait db(config.usersTable).select();\nawait client(tableName).first();",
      errors: [1, 2, 3, 4, 5, 6].map((line) => ({ messageId: "tableBuilder", line }))
    },
    {
      code: "const rows = await database.knex(\"users\");",
      errors: [{ messageId: "knexMember", data: { text: "database.knex" } }]
    },
    {
      code: "function createRepository({ database }) { const { raw } = database.knex; return raw; }",
      errors: [{ messageId: "knexMember" }]
    },
    {
      code: "await knex.transaction(async (trx) => work(trx));\nawait db.transaction(work);\nawait deps.database.transaction(work);",
      errors: [{ messageId: "handTransaction", line: 1 }, { messageId: "handTransaction", line: 2 }, { messageId: "handTransaction", line: 3 }]
    },
    {
      code: "await this.database.knex.transaction(work);",
      errors: [{ messageId: "knexMember", data: { text: "this.database.knex" } }]
    },
    {
      code: "query.from(\"users\");\nquery.table(\"users\");\nquery.insert(row).into(\"users\");",
      errors: [
        { messageId: "literalTable", data: { method: "from", table: "\"users\"" } },
        { messageId: "literalTable", data: { method: "table", table: "\"users\"" } },
        { messageId: "literalTable", data: { method: "into", table: "\"users\"" } }
      ]
    },
    {
      code: "query.join(\"room_members\", \"room_members.room_id\", \"r.id\");\nquery.leftJoin(`lots as l`, \"l.id\", \"r.lot_id\");\nquery.innerJoin(\"pets\", function () { this.on(\"pets.id\", \"=\", \"r.pet_id\"); });",
      errors: [{ messageId: "literalTable", line: 1 }, { messageId: "literalTable", line: 2 }, { messageId: "literalTable", line: 3 }]
    },
    {
      // A table named through a variable or property is joined past its owner's scope as much as a literal one.
      code: "query.leftJoin(PETS_TABLE, \"pets.id\", \"r.pet_id\");\nquery.join(tables.lots, \"lots.id\", \"r.lot_id\");\nquery.innerJoin(owners.tableName, \"owners.id\", \"r.owner_id\");",
      errors: [
        { messageId: "literalTable", data: { method: "leftJoin", table: "PETS_TABLE" }, line: 1 },
        { messageId: "literalTable", data: { method: "join", table: "tables.lots" }, line: 2 },
        { messageId: "literalTable", data: { method: "innerJoin", table: "owners.tableName" }, line: 3 }
      ]
    },
    {
      // A table name built from an expression, in a template or by concatenation, reaches that table as a literal does.
      code: [
        "query.join(`${table} as x`, \"x.id\", \"r.x_id\");",
        "query.leftJoin(`${prefix}_items`, \"i.id\", \"r.item_id\");",
        "query.from(`${schema}.events`);",
        "query.innerJoin(prefix + \"_lots\", \"l.id\", \"r.lot_id\");",
        "query.from(\"archived_\" + name).insert(row).into(base + \"_copy\");",
        "await knex(prefix + \"_rows\").select();"
      ].join("\n"),
      errors: [
        { messageId: "literalTable", data: { method: "join", table: "`${table} as x`" }, line: 1 },
        { messageId: "literalTable", data: { method: "leftJoin", table: "`${prefix}_items`" }, line: 2 },
        { messageId: "literalTable", data: { method: "from", table: "`${schema}.events`" }, line: 3 },
        { messageId: "literalTable", data: { method: "innerJoin", table: "prefix + \"_lots\"" }, line: 4 },
        { messageId: "literalTable", data: { method: "from", table: "\"archived_\" + name" }, line: 5 },
        { messageId: "literalTable", data: { method: "into", table: "base + \"_copy\"" }, line: 5 },
        { messageId: "tableBuilder", data: { text: "knex" }, line: 6 }
      ]
    },
    {
      code: "const sub = function () { this.select(\"id\").from(\"room_members\"); };",
      errors: [{ messageId: "literalTable" }]
    },
    {
      code: "// readable-check: allow no-direct-knex - infrastructure: kept as is for now\nknex(\"users\");",
      errors: [{ messageId: "tableBuilder" }]
    },
    {
      code: "// readable-check: allow no-direct-knex - infrastructure: protocol state, as the test suite expects\nknex(\"users\");",
      errors: [{ messageId: "tableBuilder" }]
    },
    {
      code: "// readable-check: allow no-direct-knex - infrastructure:\nknex(\"users\");",
      errors: [{ messageId: "tableBuilder" }]
    },
    {
      code: "import { x } from \"y\";\n// readable-check: allow no-direct-knex - infrastructure: protocol state of the sign-in flow\nknex(\"users\");",
      errors: [{ messageId: "tableBuilder" }]
    },
    {
      code: "// readable-check: allow no-transaction-reader - infrastructure: protocol state of the sign-in flow\nknex(\"users\");",
      errors: [{ messageId: "tableBuilder" }]
    },
    {
      code: "// readable-check: allow no-direct-knex - safety invariant: the sessions table is read once per request\nknex(\"sessions\");",
      errors: [{ messageId: "tableBuilder" }]
    }
  ]
});
