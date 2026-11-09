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
    // Rows the code needs whole, with a subset derived beside them: every row read is used.
    read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nreturn { rows, overdue: rows.filter(isOverdue) };"),
    read("const { records, page } = await tasks.query({ filters: { projectId }, page: { size: 20 } }, options);\nconst open = records.filter(isOpen).length;\nreturn { records: records.map(toTask), page, open };"),
    read("const page = await tasks.query({ filters: { projectId }, page: { size: 20 } }, options);\nconst first = page.records.find(isOpen);\nreturn { page, first };"),
    read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nconst late = rows.some(isOverdue);\nawait exportTasks(rows, { late });"),
    read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nfor (const row of rows) { total += row.hours; }\nreturn { total, open: rows.filter(isOpen) };"),
    // Rows matched against other items in a loop or a callback: an in-memory join or grouping, one read for all.
    read("const sections = await sectionHandle.queryAll({ filters: { moduleIds: ids } }, options);\nreturn ids.map((id) => ({ id, sections: sections.filter((section) => section.moduleId === id) }));"),
    read("const rows = await users.queryAll({ filters: { ids } }, options);\nconst result = {};\nfor (const id of ids) {\n  result[id] = rows.find((row) => row.id === id) || null;\n}\nreturn result;"),
    read("const rows = await tasks.queryAll({ filters: { projectIds: ids } }, options);\nfor (const id of ids) {\n  for (const row of rows) {\n    if (row.projectId !== id) continue;\n    await notify(id, row);\n  }\n}"),
    // A loop that uses every row before it skips some.
    read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nfor (const row of rows) {\n  await audit(row);\n  if (row.done) continue;\n  await notify(row);\n}"),
    // A read of at most one row narrows nothing.
    read("const { records } = await users.query({ filters: { id: projectId }, page: { size: 1 } }, options);\nreturn records.find((user) => user.active) || null;"),
    // A page of one written through a params wrapper, or after a spread of other params.
    read("const { records } = await vets.query(forViewer({ filters: { id: projectId }, fields: [\"id\"], page: { size: 1 } }, options), options);\nreturn records.length > 0;"),
    read("const { records } = await tasks.query({ ...params, page: { size: 1 } }, options);\nreturn records.length > 0;"),
    // One row more than the page keeps, to learn whether more follow.
    read("const rows = await knex(\"tasks\").where({ project_id: projectId }).orderBy(\"id\").limit(size + 1);\nreturn { rows: rows.slice(0, size).map(toTask), hasMore: rows.length > size };"),
    read("const page = await tasks.query({ filters: { projectId }, page: { size: size + 1 } }, options);\nconst kept = page.records.slice(0, size);\nreturn { kept, more: page.records.length > size };"),
    // The exception, above the narrowing or above the read.
    read(`const rows = await tasks.queryAll({ filters: { projectId } }, options);\n${EXCUSE}\nreturn rows.filter(isOverdue);`),
    read(`${EXCUSE}\nconst rows = await tasks.queryAll({ filters: { projectId } }, options);\nreturn { overdue: rows.filter(isOverdue), first: rows.find(Boolean) };`),
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
      // The section picker inside a branch: the narrowing runs once, not per item of something else.
      code: read("const { records } = await sections.query({ sort: [\"-createdAt\"], page: { size: 200 } }, options);\nif (projectId) {\n  return records.filter((section) => section.moduleId === projectId);\n}\nreturn [];"),
      errors: [{ messageId: "narrowsPage", data: { use: ".filter()", read: "sections.query()" }, line: 4 }]
    },
    {
      // Two narrowings of the same rows, and no use of them whole.
      code: read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\nconst open = rows.filter(isOpen);\nconst first = rows.find(isOpen);\nreturn { open, first };"),
      errors: [
        { messageId: "narrowsEvery", data: { use: ".filter()", read: "tasks.queryAll()" } },
        { messageId: "narrowsEvery", data: { use: ".find()", read: "tasks.queryAll()" } }
      ]
    },
    {
      // A slice of a capped read that asks for no extra row cuts rows it read.
      code: read("const rows = await knex(\"tasks\").where({ project_id: projectId }).limit(size);\nreturn rows.slice(0, 5).map(toTask);"),
      errors: [{ messageId: "narrowsPage", data: { use: ".slice()", read: "the Knex query" } }]
    },
    {
      // A spread after the page may replace it, so the page's size is not known.
      code: read("const { records } = await tasks.query({ page: { size: 1 }, ...params }, options);\nreturn records.length > 0;"),
      errors: [{ messageId: "narrowsPage", data: { use: "Its .length alone (a count or an existence test)", read: "tasks.query()" } }]
    },
    {
      // An exception needs the rule's name: another rule's does not excuse it.
      code: read("const rows = await tasks.queryAll({ filters: { projectId } }, options);\n// readable-check: allow no-direct-knex - every row: the export\nreturn rows.every(isOpen);"),
      errors: [{ messageId: "narrowsEvery", data: { use: ".every()", read: "tasks.queryAll()" } }]
    }
  ]
});
