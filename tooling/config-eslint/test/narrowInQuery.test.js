import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { narrowInQuery } from "../plugin/rules/narrowInQuery.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const EXCUSE = "// readable-check: allow narrow-in-query - every row: the export writes every task and marks the overdue ones beside them";
const tester = new RuleTester({ languageOptions: { ecmaVersion: "latest", sourceType: "module" } });
const read = (body) => `async function read(projectId, ids, options) {\n${body}\n}`;

tester.run("jskit/narrow-in-query", narrowInQuery, {
  valid: [
    // Mapping, grouping and handing the rows on narrow nothing.
    read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nreturn rows.map(toTask);"),
    read("const lines = await invoiceLines.queryAll({ filters: { invoiceIds: ids } }, options);\nreturn Map.groupBy(lines, (line) => line.invoiceId);"),
    read("const { records, page } = await tasks.query({ filters: { projectId }, page: { size: 20 } }, options);\nreturn { records: records.map(toTask), page };"),
    // The first row after a unique filter or a page of one.
    read("const { records } = await users.query({ filters: { id: projectId }, page: { size: 1 } }, options);\nreturn records[0] || null;"),
    read("const [holder] = await profiles.queryAll({ filters: { usernames: [projectId] }, take: 1 }, options);\nreturn holder;"),
    // The length of a read of one row is an existence test done right.
    `const FIRST = Object.freeze({ size: 1 });\nasync function hasAny(options) {\n  return (await users.query({ page: FIRST }, options)).records.length > 0;\n}`,
    read("const rows = await tasks.queryAll({ filters: { projectId }, take: 1 }, options);\nreturn rows.length > 0;"),
    read("const rows = await knex(\"tasks\").where({ project_id: projectId }).limit(1);\nreturn rows.length > 0;"),
    // A length read beside other uses is a guard, not a count.
    read("const rows = await tasks.queryAll({ filters: { id: ids } }, options);\nif (rows.length === 0) return [];\nreturn rows.map(toTask);"),
    read("const page = await tasks.query({ filters: { projectId }, page: { size: 20 } }, options);\nif (!page.records.length) return null;\nreturn page.records.map(toTask);"),
    // A loop that handles every row.
    read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nfor (const row of rows) { await notify(row); }"),
    read("for await (const records of reminders.queryPages({ filters: { status: \"due\" } }, options)) {\n  await reminders.patchWhere({ id: records.map((reminder) => reminder.id) }, { status: \"sent\" }, options);\n}"),
    // Narrowing what the code built, not what a read answered.
    read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nreturn rows.map(toTask).filter(Boolean);"),
    read("const items = await fetchItems(projectId);\nreturn items.filter(Boolean);"),
    // SQL text, a write and a single row are no reads of rows.
    read("const result = await pool.query(\"select 1\");\nreturn result.rows.filter(Boolean);"),
    read("const inserted = await knex(\"tasks\").insert(ids).returning(\"id\");\nreturn inserted.filter(Boolean);"),
    read("const row = await knex(\"tasks\").where({ id: projectId }).first();\nreturn row;"),
    // The exception, above the narrowing or above the read.
    read(`const rows = await tasks.queryAll({ filters: { projectId } }, options);\n${EXCUSE}\nreturn { rows, overdue: rows.filter(isOverdue) };`),
    read(`${EXCUSE}\nconst rows = await tasks.queryAll({ filters: { projectId } }, options);\nreturn { rows, overdue: rows.filter(isOverdue), first: rows.find(Boolean) };`),
    "function later(rows) { return rows.filter(Boolean); }\nasync function read(options) { const rows = await tasks.queryAll({}, options); return rows.map(toTask); }"
  ],
  invalid: [
    {
      // The section picker: the newest 200 sections of every module, then one module's kept in code.
      code: read("const { records } = await sections.query({ sort: [\"-createdAt\"], page: { size: 200 } }, options);\nreturn records.filter((section) => section.moduleId === projectId);"),
      errors: [{ messageId: "narrowsPage", data: { use: ".filter()", read: "sections.query()" }, line: 3 }]
    },
    {
      code: read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nreturn rows.filter((task) => task.status === \"open\");"),
      errors: [{ messageId: "narrowsEvery", data: { use: ".filter()", read: "tasks.queryAll()" } }]
    },
    {
      // json-rest-api's query without a page answers its default page.
      code: read("const { data } = await api.resources.notes.query({ queryParams: { filters: { projectId } } });\nreturn data.find((note) => note.pinned);"),
      errors: [{ messageId: "narrowsDefaultPage", data: { use: ".find()", read: "api.resources.notes.query()" } }]
    },
    {
      code: read("const memberships = await members.queryAll({ filters: { projectId } }, options);\nreturn memberships.some((member) => member.role === \"owner\");"),
      errors: [{ messageId: "narrowsEvery", data: { use: ".some()", read: "members.queryAll()" } }]
    },
    {
      code: read("return (await tasks.queryAll({ sort: [\"-createdAt\"] }, options)).slice(0, 10);"),
      errors: [{ messageId: "narrowsEvery", data: { use: ".slice()", read: "tasks.queryAll()" } }]
    },
    {
      code: read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nreturn rows.length;"),
      errors: [{ messageId: "narrowsEvery", data: { use: "Its .length alone (a count or an existence test)", read: "tasks.queryAll()" } }]
    },
    {
      code: read("const page = await tasks.query({ filters: { projectId }, page: { size: 100 } }, options);\nif (page.records.length > 0) throw new Error(\"in use\");"),
      errors: [{ messageId: "narrowsPage", data: { use: "Its .length alone (a count or an existence test)", read: "tasks.query()" } }]
    },
    {
      code: read("for (const task of await tasks.queryAll({ filters: { projectId } }, options)) {\n  if (task.done) continue;\n  await notify(task);\n}"),
      errors: [{ messageId: "narrowsEvery", data: { use: "A loop that skips rows with continue", read: "tasks.queryAll()" }, line: 3 }]
    },
    {
      code: read("for await (const records of reminders.queryPages({}, options)) {\n  await send(records.filter(isDue));\n}"),
      errors: [{ messageId: "narrowsEvery", data: { use: ".filter()", read: "reminders.queryPages()" } }]
    },
    {
      code: read("const rows = await knex(\"tasks\").where({ project_id: projectId }).limit(200);\nreturn rows.find((row) => row.id === ids[0]);"),
      errors: [{ messageId: "narrowsPage", data: { use: ".find()", read: "the Knex query" } }]
    },
    {
      code: read("const { query } = await tasks.scopedQuery({}, options);\nconst rows = await query.select(\"id\", \"status\");\nreturn rows.filter((row) => row.status === \"open\");"),
      errors: [{ messageId: "narrowsEvery", data: { use: ".filter()", read: "the Knex query" } }]
    },
    {
      code: read("return (await tasks.query({ filters: { projectId }, page: { size: 200 } }, options)).records.filter(isOpen);"),
      errors: [{ messageId: "narrowsPage", data: { use: ".filter()", read: "tasks.query()" } }]
    },
    {
      code: read("const page = await tasks.query({ page: { size: 50 } }, options);\nconst { records } = page;\nreturn records.findLast(isOpen);"),
      errors: [{ messageId: "narrowsPage", data: { use: ".findLast()", read: "tasks.query()" } }]
    },
    {
      code: read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nfor (const row of rows) {\n  if (row.archived) {\n    continue;\n  }\n  await notify(row);\n}"),
      errors: [{ messageId: "narrowsEvery", data: { use: "A loop that skips rows with continue", read: "tasks.queryAll()" } }]
    },
    {
      // An exception needs the rule's name: another rule's does not excuse it.
      code: read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\n// readable-check: allow no-direct-knex - every row: the export\nreturn rows.every(isOpen);"),
      errors: [{ messageId: "narrowsEvery", data: { use: ".every()", read: "tasks.queryAll()" } }]
    }
  ]
});
