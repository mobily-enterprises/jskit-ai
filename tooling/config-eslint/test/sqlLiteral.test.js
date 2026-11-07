import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { sqlLiteral } from "../plugin/rules/sqlLiteral.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

new RuleTester().run("jskit/sql-literal", sqlLiteral, {
  valid: [
    "query.select(receivals.raw(\"count(*) as total\"));",
    "query.whereRaw(\"?? > ?\", [receivals.column(\"amount\"), 0]);",
    "query.orderByRaw(`position asc`);",
    "receivals.patchWhere(filters, { position: receivals.raw(\"COALESCE(??, 0) + ?\", [receivals.column(\"position\"), by]) }, options);",
    "query.havingRaw(\"count(*) > ?\", [minimum]).groupByRaw(\"??\", [column]).selectRaw(\"max(??) as last\", [column]);",
    String.raw`query.whereRaw("note = 'a\\?'");`,
    "const text = String.raw({ raw: [\"a\", \"b\"] }, 1);",
    "const label = String.raw`a${name}`;"
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
      code: "// readable-check: allow sql-literal - data: the report's column list\nquery.selectRaw(columns);",
      errors: [{ messageId: "notLiteral" }]
    },
    {
      code: "// readable-check: allow sql-literal - infrastructure: the console's query runner\nquery.whereRaw(userSql);",
      errors: [{ messageId: "notLiteral" }]
    }
  ]
});
