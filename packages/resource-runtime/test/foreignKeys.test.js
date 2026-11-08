import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { checkForeignKeys } from "../src/server/index.js";
import { createResourceHost } from "../src/server/resourceHost.js";
import { createResourceRuntime } from "../src/server/resourceRuntime.js";

const owners = defineTableResource({
  name: "owners",
  tableName: "owners",
  ownership: "public",
  schema: { name: { type: "string", required: true } }
});

function petsResource(foreignKeys) {
  return defineTableResource({
    name: "pets",
    tableName: "pets",
    ownership: "public",
    schema: {
      name: { type: "string", required: true },
      ownerId: { type: "id", nullable: true, belongsTo: "owners", as: "owner" },
      vetId: { type: "id", nullable: true, storage: { column: "clinic_vet" } }
    },
    ...(foreignKeys ? { foreignKeys } : {})
  });
}

async function petsDatabase(t) {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("owners", (table) => {
    table.increments("id");
    table.string("name").notNullable();
  });
  await knex.schema.createTable("vets", (table) => table.increments("id"));
  await knex.schema.createTable("pets", (table) => {
    table.increments("id");
    table.string("name").notNullable();
    table.integer("owner_id").references("id").inTable("owners");
    table.integer("clinic_vet");
  });
  return knex;
}

test("a declared foreignKeys reaches the json-rest-api resource, and a table without one declares none", async (t) => {
  const knex = await petsDatabase(t);
  const api = await createResourceHost({ knex, logger: silentLogger });
  const declared = [{ columns: ["ownerId"], referencedTableName: "owners", deleteRule: "SET NULL" }];
  const runtime = createResourceRuntime({ api });
  const { pets } = await runtime.own("app.pets", [owners, petsResource(declared)]);
  const context = runtime.declareSystemScope("app.pets", "The test seeds every owner's pets.")("seed a pet");

  assert.deepEqual(api.resources.pets.vars.schemaInfo.foreignKeys, declared);
  assert.deepEqual(api.resources.owners.vars.schemaInfo.foreignKeys, []);
  const [ownerId] = await knex("owners").insert({ name: "Ada" });
  const created = await pets.create({ name: "Rex", ownerId: String(ownerId) }, { context });
  assert.equal(created.ownerId, String(ownerId));
  assert.equal((await pets.get(created.id, {}, { context })).ownerId, String(ownerId));
});

test("checkForeignKeys finds a declared key the database lacks, and reports a real key nothing declares", async (t) => {
  const knex = await petsDatabase(t);

  const exact = await checkForeignKeys({
    knex,
    resources: [owners, petsResource([{ columns: ["ownerId"], referencedTableName: "owners" }])],
    tables: ["owners", "pets"]
  });
  assert.deepEqual(exact, { missing: [], undeclared: [] });

  const wrong = await checkForeignKeys({
    knex,
    resources: [petsResource([
      { columns: ["ownerId"], referencedTableName: "owners", referencedColumns: ["id"] },
      { name: "pets_vet", columns: ["vetId"], referencedTableName: "vets" }
    ])],
    tables: ["pets"]
  });
  assert.deepEqual(wrong.missing.map(({ resource, tableName, columns, referencedTableName, referencedColumns, declared }) =>
    ({ resource, tableName, columns, referencedTableName, referencedColumns, name: declared.name })), [
    { resource: "pets", tableName: "pets", columns: ["clinic_vet"], referencedTableName: "vets", referencedColumns: ["id"], name: "pets_vet" }
  ]);
  assert.deepEqual(wrong.undeclared, []);

  const undeclared = await checkForeignKeys({ knex, resources: [owners, petsResource()], tables: ["pets"] });
  assert.deepEqual(undeclared, {
    missing: [],
    undeclared: [{ name: "", tableName: "pets", columns: ["owner_id"], referencedTableName: "owners", referencedColumns: ["id"] }]
  });
  assert.deepEqual((await checkForeignKeys({ knex, resources: [petsResource()], tables: [] })).undeclared, []);
});
