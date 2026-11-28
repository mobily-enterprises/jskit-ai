import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createPackageTestKnex, createTestResourceRuntime } from "../src/test/index.js";

// SQLite in memory, or on a DB_CLIENT=pg or mysql2 run a schema or database of its own (see createPackageTestKnex).
const testKnex = (t) => createPackageTestKnex(t, { environment: process.env });

const WORKSPACE_A = Object.freeze({ workspace: { id: "1" } });
// The columns a narrow join source of the pins carries: the id, the ownership field and the two fields it lists.
const NARROW = ["p.id", "p.workspace_id", "p.workflow_record_id", "p.module_version_id"];

// A wide table another owner's report reads two fields of: pins with a hidden owner and a hidden secret, two in
// workspace 1 and one in workspace 2.
async function createPinFixture(t) {
  const knex = await testKnex(t);
  await knex.schema.createTable("jc_record_pins", (table) => {
    table.increments("id");
    table.integer("workspace_id").notNullable();
    table.integer("workflow_record_id").notNullable();
    table.integer("module_version_id").notNullable();
    table.string("label").notNullable();
    table.string("note");
    table.string("pin_secret");
    table.index(["workspace_id"], "jc_record_pins_workspace");
  });
  await knex("jc_record_pins").insert([
    { workspace_id: 1, workflow_record_id: 10, module_version_id: 100, label: "A", note: "first", pin_secret: "s1" },
    { workspace_id: 1, workflow_record_id: 11, module_version_id: 101, label: "B", note: null, pin_secret: "s2" },
    { workspace_id: 2, workflow_record_id: 12, module_version_id: 102, label: "C", note: "other", pin_secret: "s3" }
  ]);
  const resource = defineTableResource({
    name: "recordPins",
    tableName: "jc_record_pins",
    ownership: "workspace",
    schema: {
      workspaceId: { type: "id", required: true, hidden: true, storage: { column: "workspace_id" } },
      workflowRecordId: { type: "integer", required: true, search: true, storage: { column: "workflow_record_id" } },
      moduleVersionId: { type: "integer", required: true, storage: { column: "module_version_id" } },
      label: { type: "string", required: true, search: true },
      note: { type: "string", nullable: true },
      pinSecret: { type: "string", nullable: true, hidden: true, storage: { column: "pin_secret" } }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { recordPins } = await runtime.own("pins.feature", [resource]);
  const system = runtime.declareSystemScope("pins.feature", "report every workspace's pins")("count the pins");
  return { pins: recordPins, system, options: { context: WORKSPACE_A } };
}

/**
 * A report's statement over a source, without identifier quotes, and the select list of each SELECT in it.
 * @param {{ query: any, column: (field: string) => string }} source
 */
function statementOf(source) {
  const { sql, bindings } = source.query.select({ record: source.column("id") }).toSQL();
  const text = sql.replace(/[`"]/gu, "");
  return { text, bindings, lists: [...text.matchAll(/select (.+?) from /gu)].map(([, list]) => list) };
}

test("a join source given columns selects only those, the id and the ownership fields, in the statement it builds without them", async (t) => {
  const { pins, options } = await createPinFixture(t);
  // Without columns, the source's derived table lists every visible field and the ownership field, never the secret.
  const every = statementOf(await pins.joinSource({ alias: "p" }, options));
  const visible = every.lists.find((list) => list.includes("p.label"));
  assert.ok(visible, every.text);
  assert.deepEqual(visible.split(", ").sort(), [...NARROW, "p.label", "p.note"].sort());
  assert.ok(!every.text.includes("pin_secret"), every.text);

  // With them, that list holds the listed fields, the id and the ownership field: the same derived tables, scope and
  // bindings otherwise.
  const narrow = statementOf(await pins.joinSource({ alias: "p", columns: ["workflowRecordId", "moduleVersionId"] }, options));
  const listed = visible.split(", ").filter((column) => NARROW.includes(column)).join(", ");
  assert.equal(narrow.text, every.text.replace(visible, listed));
  assert.deepEqual(narrow.bindings, every.bindings);
  for (const left of ["p.label", "p.note", "pin_secret"]) {
    assert.ok(!narrow.text.includes(left), narrow.text);
  }
  // The scope's own ownership field and the id need no naming, and naming them changes nothing.
  const named = statementOf(await pins.joinSource({ alias: "p", columns: ["id", "workspaceId", "moduleVersionId", "workflowRecordId"] }, options));
  assert.equal(named.text, narrow.text);
});

test("a join source refuses a columns entry that is no visible field, a hidden one included, before it reads anything", async (t) => {
  const { pins, options } = await createPinFixture(t);
  await assert.rejects(pins.joinSource({ alias: "p", columns: ["workflowRecordId", "secret_column"] }, options),
    /recordPins\.joinSource\(\) columns names "secret_column", which is not a visible field of recordPins/u);
  await assert.rejects(pins.joinSource({ alias: "p", columns: ["pinSecret"] }, options),
    /recordPins\.joinSource\(\) columns names "pinSecret", which is not a visible field of recordPins: a join source carries the stored fields a read answers, the id and the ownership fields; never another hidden field/u);
  await assert.rejects(pins.joinSource({ alias: "p", columns: "label" }, options),
    /recordPins\.joinSource\(\) columns must list the visible fields the report reads/u);
});

test("a join source given columns has no column for a field it does not list, and names the id, the ownership fields and the listed ones", async (t) => {
  const { pins, options } = await createPinFixture(t);
  const source = await pins.joinSource({ alias: "p", columns: ["workflowRecordId", "moduleVersionId"] }, options);
  assert.throws(() => source.column("label"),
    /recordPins\.joinSource\(\) was given columns \["workflowRecordId","moduleVersionId"\], so it carries no column for "label" \(only those, the id and the ownership fields\): name it in columns/u);
  assert.throws(() => source.column("pinSecret"), /recordPins\.joinSource\(\) carries no hidden field but its ownership fields, so it has no column for "pinSecret"/u);
  assert.deepEqual(["id", "workspaceId", "workflowRecordId", "moduleVersionId"].map((field) => source.column(field)),
    ["p.id", "p.workspace_id", "p.workflow_record_id", "p.module_version_id"]);
});

test("a join source given columns still answers the caller's scoped rows alone, its filters applied on fields it does not list", async (t) => {
  const { pins, system, options } = await createPinFixture(t);
  const rowsOf = async (source) => (await source.query.select("p.*").orderBy(source.column("id")))
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])));

  const narrow = await pins.joinSource({ alias: "p", columns: ["workflowRecordId"] }, options);
  assert.deepEqual(await rowsOf(narrow), [
    { id: 1, workspace_id: 1, workflow_record_id: 10 },
    { id: 2, workspace_id: 1, workflow_record_id: 11 }
  ]);
  const filtered = await pins.joinSource({ alias: "p", filters: { label: "B" }, columns: ["workflowRecordId"] }, options);
  assert.deepEqual(await rowsOf(filtered), [{ id: 2, workspace_id: 1, workflow_record_id: 11 }]);
  // Another workspace's pin stays out of a report's subquery over the source; a system context reads every workspace's.
  const outside = await pins.joinSource({ alias: "p", filters: { label: "C" }, columns: ["moduleVersionId"] }, options);
  assert.deepEqual(await rowsOf(outside), []);
  const everyWorkspace = await pins.joinSource({ alias: "p", columns: ["moduleVersionId"] }, { context: system });
  assert.deepEqual((await rowsOf(everyWorkspace)).map((row) => [row.workspace_id, row.module_version_id]), [[1, 100], [1, 101], [2, 102]]);
});
