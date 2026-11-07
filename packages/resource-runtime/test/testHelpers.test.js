import assert from "node:assert/strict";
import test from "node:test";
import knexFactory from "knex";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import {
  TestDatabaseMissingError,
  createTestResourceRuntime,
  expectEveryTableOwned,
  expectFlatQueries,
  expectScoped
} from "../src/test/index.js";

const environment = Object.freeze({ TEST_DB_NAME: "catalogue_test" });

test("expectFlatQueries() passes a path that reads its rows at once and fails one that reads them row by row", async () => {
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  try {
    await knex.schema.createTable("books", (table) => { table.increments("id"); table.integer("shelf"); table.string("title"); });
    let shelf = 0;
    // Each size gets a shelf of its own, so the sizes stay apart.
    const seed = async (size) => {
      shelf += 1;
      await knex("books").insert(Array.from({ length: size }, (_, index) => ({ shelf, title: `Book ${index + 1}` })));
      return shelf;
    };
    const atOnce = (seeded) => knex("books").where({ shelf: seeded }).orderBy("id").pluck("title");
    assert.deepEqual(
      await expectFlatQueries({ knex, environment, sizes: [3, 30], seed, run: atOnce }),
      [{ size: 3, count: 1, chunkStatements: 0 }, { size: 30, count: 1, chunkStatements: 0 }]
    );

    const rowByRow = async (seeded) => {
      const ids = await knex("books").where({ shelf: seeded }).pluck("id");
      for (const id of ids) await knex("books").where({ id }).first("title");
    };
    await assert.rejects(expectFlatQueries({ knex, environment, sizes: [3, 30], seed, run: rowByRow }), (error) => {
      assert.equal(error.name, "AssertionError");
      assert.equal(error.message, [
        "The statements grow with the rows: 4 at 3 rows, 31 at 30 rows.",
        "Repeated most at 30 rows:",
        "  30 x select `title` from `books` where `id` = ? limit ?",
        "  1 x select `id` from `books` where `shelf` = ?"
      ].join("\n"));
      return true;
    });

    let seeded = false;
    await assert.rejects(
      expectFlatQueries({ knex, environment: {}, seed: () => { seeded = true; }, run: atOnce }),
      TestDatabaseMissingError
    );
    assert.equal(seeded, false);
    for (const sizes of [[10], [200, 10], [10, 10], [0, 10], [10, 20.5]]) {
      await assert.rejects(expectFlatQueries({ knex, environment, sizes, seed, run: atOnce }), /at least two growing whole numbers/u);
    }
    await assert.rejects(expectFlatQueries({ knex, environment, seed }), /requires seed\(size\) and run\(seeded, size\)/u);
  } finally {
    await knex.destroy();
  }
});

async function createShelfFixture(t) {
  const knex = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("books", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.string("title");
  });
  const books = defineTableResource({
    name: "books",
    tableName: "books",
    ownership: "workspace",
    schema: {
      id: { type: "id", primary: true },
      workspaceId: { type: "id", search: true, storage: { column: "workspace_id" } },
      title: { type: "string", search: true }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { books: handle } = await runtime.own("books.feature", [books]);
  const systemContext = runtime.createSystemContext({ feature: "books.feature", systemScope: "tests", reason: "check scope" });
  return { knex, runtime, books: handle, systemContext };
}

test("expectFlatQueries() allows the later chunks a many-row write reports, and nothing else", async (t) => {
  const { knex, books } = await createShelfFixture(t);
  let workspace = 0;
  const seed = () => {
    workspace += 1;
    return { context: { workspace: { id: String(workspace) } } };
  };
  const createInChunks = (options, size) => books.createMany(
    Array.from({ length: size }, (_, index) => ({ title: `Book ${index}` })),
    { ...options, chunkSize: 5 }
  );
  const counts = await expectFlatQueries({ knex, environment, sizes: [3, 30], seed, run: createInChunks });
  assert.deepEqual(counts.map(({ size, chunkStatements }) => [size, chunkStatements]), [[3, 0], [30, 5]]);

  const oneByOne = async (options, size) => {
    for (let index = 0; index < size; index += 1) {
      await books.create({ title: `Book ${index}` }, { ...options, returning: "none" });
    }
  };
  await assert.rejects(expectFlatQueries({ knex, environment, sizes: [3, 30], seed, run: oneByOne }), /The statements grow with the rows/u);
});

test("expectScoped() passes a path that keeps to its workspace and fails one that reaches another", async (t) => {
  const { books, systemContext } = await createShelfFixture(t);
  const owners = [{ context: { workspace: { id: "1" } } }, { context: { workspace: { id: "2" } } }];
  const seed = (owner) => books.createMany([{ title: "a" }, { title: "b" }], owner);
  const handles = [books];

  const result = await expectScoped({
    environment,
    handles,
    systemContext,
    owners,
    seed,
    run: (owner) => books.queryAll({}, owner)
  });
  assert.equal(result.length, 2);

  await assert.rejects(
    expectScoped({ environment, handles, systemContext, owners, seed, run: () => books.queryAll({}, { context: systemContext }) }),
    /holds books:\d+, a row of the other owner/u
  );
  await assert.rejects(
    expectScoped({ environment, handles, systemContext, owners, seed, run: () => books.patchWhere({}, { title: "every" }, { context: systemContext, all: true }) }),
    /changed books:\d+, a row of the other owner/u
  );
  await assert.rejects(expectScoped({ environment: {}, handles, systemContext, owners, seed, run: seed }), TestDatabaseMissingError);
});

test("expectEveryTableOwned() names each table no feature owns", async (t) => {
  const { knex, runtime } = await createShelfFixture(t);
  await expectEveryTableOwned({ knex, runtime, environment });
  await knex.schema.createTable("loose_notes", (table) => table.increments("id"));
  await assert.rejects(expectEveryTableOwned({ knex, runtime, environment }), /Tables no feature owns: loose_notes\./u);
  await expectEveryTableOwned({ knex, runtime, infrastructureTables: ["loose_notes"], environment });
});
