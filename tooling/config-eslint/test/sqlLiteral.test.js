import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { sqlLiteral } from "../plugin/rules/sqlLiteral.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/sql-literal", sqlLiteral, {
  valid: [
    "query.select(receivals.raw(\"count(*) as total\"));",
    // A console that runs the person's own SQL by design takes the infrastructure exception for this rule.
    "// readable-check: allow sql-literal - infrastructure: the database console runs the statement the person typed\nconst rows = await knex.raw(statement);",
    // A file on Knex itself, past no-direct-knex, may run a statement as one literal with its bindings.
    "// readable-check: allow no-direct-knex - infrastructure: the operator's cutover import\nawait trx.raw(\"UPDATE pet_notes SET label = ? WHERE workspace_id = ?\", [label, workspaceId]);",
    "query.whereRaw(\"?? > ?\", [receivals.column(\"amount\"), 0]);",
    "query.orderByRaw(`position asc`);",
    "receivals.patchWhere(filters, { position: receivals.raw(\"COALESCE(??, 0) + ?\", [receivals.column(\"position\"), by]) }, options);",
    "query.havingRaw(\"count(*) > ?\", [minimum]).groupByRaw(\"??\", [column]).selectRaw(\"max(??) as last\", [column]);",
    String.raw`query.whereRaw("note = 'a\\?'");`,
    "const text = String.raw({ raw: [\"a\", \"b\"] }, 1);",
    "const label = String.raw`a${name}`;",
    "query.select({ year: visits.raw(\"EXTRACT(YEAR FROM ??)\", [visits.column(\"visitedAt\")]) });",
    "query.select({ fromDate: visits.raw(\"DATE(??)\", [visits.column(\"from_date\")]) });",
    // A query field's select destructures raw.
    "const field = { select({ raw, column }) { return raw(\"?? - coalesce(??, 0)\", [column(\"receivedWeight\"), column(\"processedWeight\")]); } };"
  ],
  invalid: [
    {
      code: "const rows = await query.select(handle.raw(`count(${column}) as total`));",
      errors: [{ messageId: "notLiteral", data: { method: "raw", text: "`count(${column}) as total`" } }]
    },
    {
      code: "query.whereRaw(\"amount > \" + minimum);\nquery.orWhereRaw(condition, [value]);",
      errors: [{ messageId: "notLiteral", line: 1 }, { messageId: "notLiteral", line: 2 }]
    },
    {
      code: "query.orderByRaw(sortSql).groupByRaw(groups.join(\", \")).havingRaw(having);",
      errors: [{ messageId: "notLiteral" }, { messageId: "notLiteral" }, { messageId: "notLiteral" }]
    },
    {
      code: "query.joinRaw(joinSql, bindings).fromRaw(`${table} as t`).selectRaw(...parts);",
      errors: [{ messageId: "notLiteral" }, { messageId: "notLiteral" }, { messageId: "notLiteral" }]
    },
    {
      code: "query.whereRaw(\"amount > ?\");\nquery.select(handle.raw(\"?? as total\"));\nquery.orderByRaw(`?? desc`);",
      errors: [
        { messageId: "noBindings", data: { method: "whereRaw" }, line: 1 },
        { messageId: "noBindings", data: { method: "raw" }, line: 2 },
        { messageId: "noBindings", data: { method: "orderByRaw" }, line: 3 }
      ]
    },
    {
      code: [
        "await handle.raw(\"DELETE FROM receivals\");",
        "query.whereRaw(\"?? in (select id from other_table)\", [column]);",
        "receivals.raw(\"insert into audit values (?)\", [value]);",
        "query.joinRaw(\"LEFT JOIN payments ON payments.id = receivals.payment_id\");",
        "query.select(handle.raw(\"(UPDATE x SET y = 1)\"));",
        "query.select(handle.raw(\"1 INTO OUTFILE '/tmp/x'\"));"
      ].join("\n"),
      errors: [
        { messageId: "statement", data: { method: "raw", word: "DELETE" }, line: 1 },
        { messageId: "statement", data: { method: "whereRaw", word: "FROM" }, line: 2 },
        { messageId: "statement", data: { method: "raw", word: "INSERT" }, line: 3 },
        { messageId: "statement", data: { method: "joinRaw", word: "JOIN" }, line: 4 },
        { messageId: "statement", data: { method: "raw", word: "UPDATE" }, line: 5 },
        { messageId: "statement", data: { method: "raw", word: "INTO" }, line: 6 }
      ]
    },
    {
      // A query field's raw, destructured, is held to the same rules.
      code: "const field = { select({ raw, column }) { return raw(`${column(\"a\")} + 1`); } };\nraw(\"?? + 1\");\nraw(\"(select max(id) from other_table)\", []);",
      errors: [
        { messageId: "notLiteral", data: { method: "raw", text: "`${column(\"a\")} + 1`" }, line: 1 },
        { messageId: "noBindings", data: { method: "raw" }, line: 2 },
        { messageId: "statement", data: { method: "raw", word: "FROM" }, line: 3 }
      ]
    },
    {
      code: "// readable-check: allow sql-literal - data: the report's column list\nquery.selectRaw(columns);",
      errors: [{ messageId: "notLiteral" }]
    },
    {
      // The exception holds only before the first line of code.
      code: "const x = 1;\n// readable-check: allow sql-literal - infrastructure: the console's query runner\nquery.whereRaw(userSql);",
      errors: [{ messageId: "notLiteral", line: 3 }]
    },
    {
      // A file on Knex itself may run a statement, but still only as one literal with its bindings.
      code: "// readable-check: allow no-direct-knex - infrastructure: the operator's cutover import\nawait trx.raw(`UPDATE ${table} SET label = ?`, [label]);\nawait trx.raw(\"DELETE FROM imported WHERE batch = ?\");",
      errors: [{ messageId: "notLiteral", line: 2 }, { messageId: "noBindings", line: 3 }]
    }
  ]
});
