import assert from "node:assert/strict";
import test from "node:test";
import knexFactory from "knex";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createPackageTestKnex, createTestResourceRuntime, expectEveryTableOwned, expectFlatQueries, expectScoped, startTestFeatures, TestDatabaseMissingError } from "../src/test/index.js";

// SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
const testKnex = (t) => createPackageTestKnex(t, { environment: process.env });

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
    // Counted on a channel the path does not use (another Knex client than its own), it measures nothing.
    const elsewhere = knexFactory({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
    try {
      await assert.rejects(expectFlatQueries({ knex: elsewhere, environment, sizes: [3, 30], seed, run: atOnce }), /sent no statement at any size/u);
    } finally {
      await elsewhere.destroy();
    }
  } finally {
    await knex.destroy();
  }
});

async function createShelfFixture(t) {
  const knex = await testKnex(t);
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
  const systemContext = runtime.declareSystemScope("books.feature", "tests")("check scope");
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
    { ...options, chunkSize: 100 }
  );
  const counts = await expectFlatQueries({ knex, environment, sizes: [3, 300], seed, run: createInChunks });
  assert.deepEqual(counts.map(({ size, chunkStatements }) => [size, chunkStatements]), [[3, 0], [300, 2]]);

  const oneByOne = async (options, size) => {
    for (let index = 0; index < size; index += 1) {
      await books.create({ title: `Book ${index}` }, { ...options, returning: "none" });
    }
  };
  await assert.rejects(expectFlatQueries({ knex, environment, sizes: [3, 30], seed, run: oneByOne }), /The statements grow with the rows/u);
});

test("expectFlatQueries() counts only the path's own statements and many-row writes, not those of work beside it", async (t) => {
  const { knex, books } = await createShelfFixture(t);
  let workspace = 0;
  const seed = () => {
    workspace += 1;
    return { context: { workspace: { id: String(workspace) } } };
  };
  // Work beside the path, started before it, as another test or a background loop is: woken by the path, it writes
  // row by row and in chunks, as many rows as the path has, while the path waits for it.
  let wake = null;
  const beside = (async () => {
    const options = { context: { workspace: { id: "999" } }, returning: "none" };
    for (;;) {
      const { size, done } = await new Promise((resolve) => { wake = resolve; });
      if (!size) return;
      for (let index = 0; index < size; index += 1) await books.create({ title: `Beside ${index}` }, options);
      await books.createMany(Array.from({ length: size * 10 }, (_, index) => ({ title: `Beside ${index}` })), { ...options, chunkSize: 100 });
      done();
    }
  })();
  const flatPath = async (options, size) => {
    await new Promise((done) => wake({ size, done }));
    return books.queryAll({}, options);
  };
  try {
    const counts = await expectFlatQueries({ knex, environment, sizes: [3, 30], seed, run: flatPath });
    assert.deepEqual(counts.map(({ chunkStatements }) => chunkStatements), [0, 0], "the work beside it wrote 300 rows in 3 chunks");
    assert.equal(counts[0].count, counts[1].count);
  } finally {
    wake({});
    await beside;
  }
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
    /answered differently once the other owner's rows were seeded/u
  );
  await assert.rejects(
    expectScoped({ environment, handles, systemContext, owners, seed, run: () => books.patchWhere({}, { title: "every" }, { context: systemContext, all: true }) }),
    /changed books:\d+, a row of the other owner/u
  );
  await assert.rejects(
    expectScoped({ environment, handles, systemContext, owners, seed, run: () => books.deleteWhere({ title: "b" }, { context: systemContext }) }),
    /removed books:\d+, a row of the other owner/u
  );
  await assert.rejects(expectScoped({ environment: {}, handles, systemContext, owners, seed, run: seed }), TestDatabaseMissingError);
});

test("expectScoped() fails a report that joins another owner's table by name, though no row of it is in the answer", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("visits", (table) => { table.increments("id"); table.integer("workspace_id"); table.string("person"); });
  await knex.schema.createTable("people", (table) => { table.increments("id"); table.integer("workspace_id"); table.string("name"); table.string("business"); });
  const owned = (name, schema) => defineTableResource({
    name,
    tableName: name,
    ownership: "workspace",
    schema: { id: { type: "id", primary: true }, workspaceId: { type: "id", search: true, storage: { column: "workspace_id" } }, ...schema }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { visits } = await runtime.own("visits.feature", [owned("visits", { person: { type: "string" } })]);
  const { people } = await runtime.own("people.feature", [owned("people", { name: { type: "string" }, business: { type: "string" } })]);
  const systemContext = runtime.declareSystemScope("visits.feature", "tests")("check scope");
  const owners = [{ context: { workspace: { id: "1" } }, business: "business A" }, { context: { workspace: { id: "2" } }, business: "business B" }];
  const seed = async ({ context, business }) => {
    await visits.create({ person: "Pat" }, { context, returning: "none" });
    await people.create({ name: "Pat", business }, { context, returning: "none" });
  };

  // Knex: report - each visit with where its person works, joining the people table by name: it reads every owner's people
  async function visitLabels(options) {
    const { query } = await visits.scopedQuery({ alias: "v" }, options);
    const rows = await query.join("people", "people.name", visits.column("person", "v")).select("people.name", "people.business").orderBy("people.id");
    return rows.map((row) => `${row.name} at ${row.business}`);
  }

  // Each answer is text, so no row of the other owner's is in it by id; the second answer gained one.
  await assert.rejects(
    expectScoped({ environment, handles: [visits, people], systemContext, owners, seed, run: (owner) => visitLabels(owner) }),
    (error) => {
      assert.equal(error.name, "AssertionError");
      assert.match(error.message, /answered differently once the other owner's rows were seeded/u);
      assert.deepEqual(error.expected, ["Pat at business A"]);
      assert.deepEqual(error.actual, ["Pat at business A", "Pat at business B"]);
      return true;
    }
  );
});

test("expectScoped() compares the other owner's stored rows, so a changed hidden column or one outside the schema fails", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("keys", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.string("label");
    table.string("secret");
    table.string("note");
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { keys } = await runtime.own("keys.feature", [defineTableResource({
    name: "keys",
    tableName: "keys",
    ownership: "workspace",
    schema: {
      id: { type: "id", primary: true },
      workspaceId: { type: "id", search: true, hidden: true, storage: { column: "workspace_id" } },
      label: { type: "string", search: true },
      secret: { type: "string", hidden: true }
    }
  })]);
  const systemContext = runtime.declareSystemScope("keys.feature", "tests")("check scope");
  const owners = [{ context: { workspace: { id: "1" } } }, { context: { workspace: { id: "2" } } }];
  const seed = (owner) => keys.createMany([{ label: "a", secret: "s" }, { label: "b", secret: "s" }], { ...owner, returning: "none" });
  const scoped = (run) => expectScoped({ environment, handles: [keys], systemContext, owners, seed, run });

  const result = await scoped((owner) => keys.queryAll({}, owner));
  assert.deepEqual(result.map(({ label }) => label).sort(), ["a", "b"]);
  await assert.rejects(
    scoped(() => keys.patchWhere({ label: "b" }, { secret: "rewritten" }, { context: systemContext, returning: "none" })),
    /changed keys:\d+, a row of the other owner/u
  );
  // Knex: write - a column outside the table resource's schema, changed for every workspace
  await assert.rejects(scoped(() => knex("keys").update({ note: "everyone's" })), /changed keys:\d+, a row of the other owner/u);
});

test("expectScoped() reads back only the other owner's rows, so a table past queryAll's row limit is checked too", async (t) => {
  const { knex, books, systemContext } = await createShelfFixture(t);
  await knex.batchInsert("books", Array.from({ length: 10_001 }, (_, index) => ({ workspace_id: 3, title: `Old ${index}` })), 500);
  const owners = [{ context: { workspace: { id: "1" } } }, { context: { workspace: { id: "2" } } }];
  const result = await expectScoped({
    environment,
    handles: [books],
    systemContext,
    owners,
    seed: (owner) => books.createMany([{ title: "a" }, { title: "b" }], owner),
    run: (owner) => books.queryAll({}, owner)
  });
  assert.deepEqual(result.map(({ title }) => title).sort(), ["a", "b"]);
});

test("expectEveryTableOwned() names each table no feature owns", async (t) => {
  const { knex, runtime } = await createShelfFixture(t);
  await expectEveryTableOwned({ knex, runtime, environment });
  await knex.schema.createTable("loose_notes", (table) => table.increments("id"));
  await assert.rejects(expectEveryTableOwned({ knex, runtime, environment }), /Tables no feature owns: loose_notes\./u);
  await expectEveryTableOwned({ knex, runtime, infrastructureTables: ["loose_notes"], environment });
});

test("startTestFeatures() starts features in the order their requires give, on tables it creates, and boots them", async (t) => {
  const knex = await testKnex(t);
  const shelves = defineTableResource({
    name: "shelves",
    tableName: "shelves",
    ownership: "workspace",
    schema: { workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } }, label: { type: "string", required: true } }
  });
  const order = [];
  const ShelvesFeature = defineFeature({
    id: "shelves",
    owns: [shelves],
    systemScope: "count every workspace's shelves",
    provides: { shelfRecords: "shelves.records" },
    setup: ({ resources, systemContext }) => {
      order.push("shelves");
      return {
        shelfRecords: Object.freeze({
          add: (label, options) => resources.shelves.create({ label }, options),
          countAll: () => resources.shelves.aggregate({ measures: { shelves: { count: "id" } } }, { context: systemContext("count every shelf") })
        })
      };
    }
  });
  // Listed first, it still starts after the feature whose records it requires, and its boot runs after every setup.
  const ReportsFeature = defineFeature({
    id: "reports",
    requires: { shelfRecords: "shelves.records" },
    provides: { reports: "reports" },
    setup: ({ shelfRecords }) => {
      order.push("reports");
      return { reports: Object.freeze({ shelfCount: async () => (await shelfRecords.countAll())[0].shelves }) };
    }
  });
  const Sealer = defineProvider({ id: "test.sealer", setup: () => ({}), boot: () => { order.push("boot"); } });
  const { capabilities, resources, stop } = await startTestFeatures({
    knex,
    features: [ReportsFeature, Sealer, ShelvesFeature],
    requires: { reports: "reports", shelfRecords: "shelves.records" },
    createTables: true
  });
  t.after(stop);
  await capabilities.shelfRecords.add("fiction", { context: { workspace: { id: "1" } } });
  await capabilities.shelfRecords.add("poetry", { context: { workspace: { id: "2" } } });
  assert.equal(await capabilities.reports.shelfCount(), 2);
  assert.deepEqual(order, ["shelves", "reports", "boot"]);
  assert.deepEqual(resources.ownedTables(), [{ name: "shelves", tableName: "shelves", featureId: "shelves" }]);
});

test("an owned table's row policy receives the capabilities its feature requires, as its setup does", async (t) => {
  const knex = await testKnex(t);
  const shelves = defineTableResource({
    name: "shelves",
    tableName: "shelves",
    ownership: "workspace",
    schema: { workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } }, label: { type: "string", required: true } }
  });
  // What the policy needs from another feature: the labels each person may see, as a membership service answers them.
  const Visibility = defineProvider({
    id: "test.visibility",
    provides: { visibility: "shelves.visibility" },
    setup: () => ({ visibility: Object.freeze({ labelsFor: (userId) => (String(userId) === "7" ? ["fiction"] : []) }) })
  });
  const received = [];
  const ShelvesFeature = defineFeature({
    id: "shelves",
    requires: { visibility: "shelves.visibility" },
    owns: [{
      resource: shelves,
      rowPolicy: ({ query, caller, column, requires }) => {
        received.push(requires);
        if (caller.kind !== "user") return caller.kind !== "anonymous";
        query.whereIn(column("label"), requires.visibility.labelsFor(caller.userId));
        return true;
      }
    }],
    systemScope: "add shelves for a test",
    provides: { shelfRecords: "shelves.records" },
    setup: ({ resources, systemContext, visibility }) => ({
      shelfRecords: Object.freeze({
        setupVisibility: visibility,
        add: (label, workspaceId) => resources.shelves.create({ label }, { context: systemContext("add a shelf").forWorkspace(workspaceId), returning: "none" }),
        labels: async (options) => (await resources.shelves.queryAll({}, options)).map(({ label }) => label).sort()
      })
    })
  });
  const { capabilities, stop } = await startTestFeatures({
    knex,
    features: [ShelvesFeature, Visibility],
    requires: { shelfRecords: "shelves.records" },
    createTables: true
  });
  t.after(stop);
  await capabilities.shelfRecords.add("fiction", "1");
  await capabilities.shelfRecords.add("poetry", "1");
  const asPerson = (userId) => ({ context: { actor: { id: userId }, workspace: { id: "1" } } });
  assert.deepEqual(await capabilities.shelfRecords.labels(asPerson("7")), ["fiction"]);
  assert.deepEqual(await capabilities.shelfRecords.labels(asPerson("8")), []);
  assert.deepEqual(Object.keys(received.at(-1)), ["visibility"], "the feature's own dependencies, by local name");
  assert.equal(received.at(-1).visibility, capabilities.shelfRecords.setupVisibility, "the same capability its setup received");
});
