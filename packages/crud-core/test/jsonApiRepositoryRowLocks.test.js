import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import {
  createJsonRestApiHost,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createCrudJsonApiRepository } from "../src/server/jsonApiModule/repository.js";
import { createCrudJsonApiService } from "../src/server/jsonApiModule/service.js";

// The PostgreSQL case runs in a disposable schema of the test database: run with DB_NAME set to
// TEST_DB_NAME (and the usual DB_HOST, DB_PORT, DB_USER and DB_PASSWORD) and DB_CLIENT unset or pg.
const TEST_DB_NAME = process.env.TEST_DB_NAME?.trim();
const ON_POSTGRES_TEST_DATABASE = Boolean(TEST_DB_NAME) && process.env.DB_NAME === TEST_DB_NAME &&
  (!process.env.DB_CLIENT || process.env.DB_CLIENT === "pg");

const counters = defineTableResource({
  name: "counters",
  tableName: "counters",
  schema: {
    name: { type: "string", required: true },
    hits: { type: "number", required: true }
  }
});

async function createRepository(knex) {
  await knex.schema.createTable("counters", (table) => {
    table.increments("id");
    table.string("name").notNullable();
    table.integer("hits").notNullable();
  });
  await knex("counters").insert({ name: "Drier", hits: 0 });
  const api = await createJsonRestApiHost({ knex, logger: silentLogger });
  await api.addResource("counters", createJsonRestResourceScopeOptions(counters));
  return createCrudJsonApiRepository({ api, resource: counters, resourceScopeName: "counters" });
}

test("getDocumentById forUpdate needs the caller's transaction and refuses anything but a boolean", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  const repository = await createRepository(knex);
  const service = createCrudJsonApiService({ repository });

  await assert.rejects(
    () => repository.getDocumentById(1, {}, { forUpdate: true }),
    (error) => error instanceof TypeError && error.message.includes("forUpdate") && error.message.includes("options.trx")
  );
  await assert.rejects(() => service.getDocumentById(1, {}, { forUpdate: true }), TypeError);
  for (const forUpdate of ["yes", 1]) {
    await assert.rejects(
      () => repository.getDocumentById(1, {}, { forUpdate }),
      (error) => error instanceof TypeError && error.message.includes("must be true or false"),
      String(forUpdate)
    );
  }

  const plain = await repository.getDocumentById(1);
  await repository.withTransaction(async (trx) => {
    assert.deepEqual(await repository.getDocumentById(1, {}, { trx, forUpdate: true }), plain);
    assert.equal(await repository.getDocumentById(99, {}, { trx, forUpdate: true }), null);
    assert.deepEqual((await service.getDocumentById(1, {}, { trx, forUpdate: true })).value, plain);
  });
  assert.deepEqual(await repository.getDocumentById(1, {}, { forUpdate: false }), plain);
});

// Two transactions each read the counter forUpdate, then write hits + 1. The second one's read
// waits on the first one's lock, so it reads the committed 1 and writes 2: no update is lost.
test("a forUpdate read waits for another transaction's lock on the record (PostgreSQL)", {
  skip: ON_POSTGRES_TEST_DATABASE ? false : "not on a PostgreSQL test database (DB_NAME=$TEST_DB_NAME)"
}, async (t) => {
  const schema = `crud_row_lock_test_${process.pid}_${Date.now()}`;
  const connection = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: TEST_DB_NAME
  };
  const admin = knexLib({ client: "pg", connection });
  await admin.raw("create schema ??", [schema]);
  const knex = knexLib({ client: "pg", connection, searchPath: [schema], pool: { min: 0, max: 4 } });
  t.after(async () => {
    await knex.destroy();
    await admin.raw("drop schema ?? cascade", [schema]);
    await admin.destroy();
  });
  const repository = await createRepository(knex);
  const hitsOf = (document) => document.data.attributes.hits;

  const events = [];
  let releaseFirst;
  const firstHoldsLock = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let firstLocked;
  const firstLockTaken = new Promise((resolve) => {
    firstLocked = resolve;
  });

  const first = repository.withTransaction(async (trx) => {
    const document = await repository.getDocumentById(1, {}, { trx, forUpdate: true });
    events.push(`first read ${hitsOf(document)}`);
    firstLocked();
    await firstHoldsLock;
    await repository.patchDocumentById(1, { hits: hitsOf(document) + 1 }, { trx, returning: "none" });
    events.push("first commits");
  });
  await firstLockTaken;

  const second = repository.withTransaction(async (trx) => {
    const document = await repository.getDocumentById(1, {}, { trx, forUpdate: true });
    events.push(`second read ${hitsOf(document)}`);
    await repository.patchDocumentById(1, { hits: hitsOf(document) + 1 }, { trx, returning: "none" });
  });

  // The second transaction is blocked on a row lock before the first one writes.
  let waiting = 0;
  for (let attempt = 0; attempt < 200 && waiting < 1; attempt++) {
    const { rows } = await admin.raw(
      "select count(*)::int as waiting from pg_stat_activity where datname = current_database() " +
        "and wait_event_type = 'Lock' and query ilike '%from \"counters\"%for update%'"
    );
    waiting = rows[0].waiting;
    if (waiting < 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.ok(waiting >= 1, "the second forUpdate read is waiting on the lock");
  assert.deepEqual(events, ["first read 0"]);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first read 0", "first commits", "second read 1"]);
  assert.equal(hitsOf(await repository.getDocumentById(1)), 2);
});
