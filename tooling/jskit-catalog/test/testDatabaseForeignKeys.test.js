import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import knexLib from "knex";
import { foreignKeyCheckFor } from "../scripts/test-databases.mjs";

// The project sits inside the repository, so its modules resolve the workspace's @jskit-ai packages.
const HERE = fileURLToPath(new URL("./", import.meta.url));

function petsModule(foreignKeys) {
  return [
    "import { defineTableResource } from \"@jskit-ai/resource-core/shared/tableResource\";",
    "export const petResource = defineTableResource({",
    "  name: \"pets\",",
    "  tableName: \"pets\",",
    "  ownership: \"public\",",
    "  schema: { ownerId: { type: \"id\", nullable: true }, vetId: { type: \"id\", nullable: true } },",
    ...(foreignKeys ? [`  foreignKeys: ${JSON.stringify(foreignKeys)}`] : []),
    "});",
    ""
  ].join("\n");
}

// A table resource "visits" on the table `tableName`, each visit naming its pet, a key the database does not hold.
function visitsModule(tableName) {
  return [
    "import { defineTableResource } from \"@jskit-ai/resource-core/shared/tableResource\";",
    "export const visitResource = defineTableResource({",
    "  name: \"visits\",",
    `  tableName: ${JSON.stringify(tableName)},`,
    "  ownership: \"public\",",
    "  schema: { petId: { type: \"id\" } },",
    "  foreignKeys: [{ columns: [\"petId\"], referencedTableName: \"pets\" }]",
    "});",
    ""
  ].join("\n");
}

async function withPetsProject(t, files) {
  const root = await mkdtemp(path.join(HERE, ".foreign-key-project-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries({ "package.json": "{ \"type\": \"module\" }\n", ...files })) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("owners", (table) => table.increments("id"));
  await knex.schema.createTable("pets", (table) => {
    table.increments("id");
    table.integer("owner_id").references("id").inTable("owners");
    table.integer("vet_id");
  });
  return { check: foreignKeyCheckFor(root), knex };
}

test("jskit test --databases passes declared foreign keys the database holds", async (t) => {
  const { check, knex } = await withPetsProject(t, {
    "src/shared/petResource.js": petsModule([{ columns: ["ownerId"], referencedTableName: "owners" }])
  });
  assert.equal(await check(knex), "foreign keys: 1 declared, all in the database");
});

test("jskit test --databases fails on a declared foreign key the database lacks", async (t) => {
  const { check, knex } = await withPetsProject(t, {
    "src/shared/petResource.js": petsModule([
      { columns: ["ownerId"], referencedTableName: "owners" },
      { columns: ["vetId"], referencedTableName: "vets" }
    ])
  });
  await assert.rejects(check(knex), /1 declared foreign key\(s\) the test database does not hold[\s\S]*pets: pets \(vet_id\) -> vets \(id\)/u);
});

test("jskit test --databases reports a key of the app's tables that nothing declares", async (t) => {
  const { check, knex } = await withPetsProject(t, { "src/shared/petResource.js": petsModule() });
  assert.match(await check(knex), /foreign keys: 0 declared, all in the database; 1 database key\(s\) on the app's tables are not declared[\s\S]*pets \(owner_id\) -> owners \(id\)$/u);
});

test("jskit test --databases refuses foreignKeys on a table resource it cannot import", async (t) => {
  const { check, knex } = await withPetsProject(t, {
    "src/shared/petResource.js": petsModule([{ columns: ["ownerId"], referencedTableName: "owners" }]).replace("export const", "const")
  });
  await assert.rejects(check(knex), /src\/shared\/petResource\.js:2 declares foreignKeys on a table resource the module does not export/u);
});

test("jskit test --databases leaves out a JSKIT package's table the database does not have", async (t) => {
  // An installed package whose migrations the app never runs, such as one only a devDependency brings.
  const { check, knex } = await withPetsProject(t, {
    "src/shared/petResource.js": petsModule([{ columns: ["ownerId"], referencedTableName: "owners" }]),
    "node_modules/@jskit-ai/clinic/package.json": "{ \"name\": \"@jskit-ai/clinic\", \"type\": \"module\" }\n",
    "node_modules/@jskit-ai/clinic/src/shared/visitResource.js": visitsModule("clinic_visits")
  });
  assert.equal(await check(knex),
    "foreign keys: 1 declared, all in the database (1 JSKIT package table(s) the database does not have are not checked)");
});

test("jskit test --databases fails on an app table resource's keys when the database does not have its table", async (t) => {
  const { check, knex } = await withPetsProject(t, { "src/shared/visitResource.js": visitsModule("visits") });
  await assert.rejects(check(knex), /1 declared foreign key\(s\) the test database does not hold[\s\S]*visits: visits \(pet_id\) -> pets \(id\)/u);
});
