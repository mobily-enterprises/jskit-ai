import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../src/test/index.js";
import { ownMysqlDatabase } from "./support/mysqlDatabase.js";

// First saves of new keys from two transactions at once on MySQL and MariaDB. InnoDB's locking read of a key no row
// holds locks the gap where the key would go, and gap locks never wait for each other: two transactions that each lock
// one gap so, then insert into it, each wait for the other's gap lock, and one is killed as a deadlock. createMany's
// upserts take no such lock, so new keys that fall in one gap go in side by side. Every transaction here runs once
// (retry: false), so a deadlock fails the test rather than being run again. lockOrCreate still locks first: an upsert
// reads its keys plainly, and a plain read before the lock would fix the snapshot its work reads.

const inWorkspace = (id) => Object.freeze({ context: Object.freeze({ workspace: Object.freeze({ id: String(id) }) }) });
// The counters have no owners; a workspace's request uses them, as the PostgreSQL lock tests' balances.
const PUBLIC = inWorkspace(1);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const outcomeOf = (promise) => promise.then(() => "saved", (error) => String(error?.code ?? error?.cause?.code ?? error?.message));

// A table with no owners keyed by an id the server computes, as lockOrCreate takes.
const counterResource = defineTableResource({
  name: "counters",
  tableName: "counters",
  ownership: "public",
  schema: {
    id: { type: "string", primary: true },
    amount: { type: "integer", defaultTo: 0 }
  }
});
// One binding per workspace and scope key, as a workspace's settings for one scope are.
const bindingResource = defineTableResource({
  name: "bindings",
  tableName: "bindings",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    scopeKey: { type: "string", required: true, storage: { column: "scope_key" } },
    value: { type: "string", nullable: true }
  }
});

async function database(t, suffix) {
  const knex = await ownMysqlDatabase(t, suffix);
  await knex.schema.createTable("counters", (table) => {
    table.string("id").primary();
    table.integer("amount").notNullable().defaultTo(0);
  });
  await knex.schema.createTable("bindings", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("scope_key").notNullable();
    table.string("value").nullable();
    table.unique(["workspace_id", "scope_key"]);
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { counters, bindings } = await runtime.own("counters.feature", [counterResource, bindingResource]);
  return { knex, counters, bindings };
}

/** A transaction of `handle`'s held open until commit() or rollback(); it runs once. */
async function holdTransaction(handle, options) {
  let opened;
  const ready = new Promise((resolve) => {
    opened = resolve;
  });
  let finish;
  const finished = new Promise((resolve, reject) => {
    finish = { resolve, reject };
  });
  const outcome = handle.withTransaction({ ...options, retry: false }, (txOptions) => {
    opened(txOptions);
    return finished;
  });
  outcome.catch(() => {});
  return {
    txOptions: await Promise.race([ready, outcome.then(() => assert.fail("the transaction ended before it opened"))]),
    commit: () => {
      finish.resolve();
      return outcome;
    },
    rollback: () => {
      finish.reject(new Error("rolled back by the test"));
      return outcome.catch(() => {});
    }
  };
}

test("lockOrCreate's work reads what the record's previous holder committed: its lock comes before any plain read", async (t) => {
  const { counters } = await database(t, "da_gap_lock_first");
  await counters.lockOrCreate({ id: "hot", amount: 0 }, PUBLIC, () => undefined);
  const first = await holdTransaction(counters, PUBLIC);
  const second = await holdTransaction(counters, PUBLIC);
  let seen;
  try {
    // The first transaction holds the record and adds a row beside it.
    await counters.lockOrCreate({ id: "hot", amount: 0 }, first.txOptions, (_record, txOptions) =>
      txOptions.trx("counters").insert({ id: "beside", amount: 5 }));
    // The second waits for the record, then reads the table plainly.
    const pending = counters.lockOrCreate({ id: "hot", amount: 0 }, second.txOptions, async (_record, txOptions) =>
      (await txOptions.trx("counters").orderBy("id").select("id")).map(({ id }) => id));
    pending.catch(() => {});
    await pause(300);
    await first.commit();
    seen = await pending;
    await second.commit();
  } finally {
    await first.rollback();
    await second.rollback();
  }
  assert.deepEqual(seen, ["beside", "hot"]);
});

test("first saves of new keys in one gap from two transactions at once never deadlock: 20 rounds in each start order, no retry", async (t) => {
  const { knex, bindings } = await database(t, "da_gap_rounds");
  // Every pair's keys sort after every stored one, so both go into the last gap of the index.
  const neighbour = (base, round, order, side) => base + round * 4 + (order === "ab" ? 0 : 2) + (side === "a" ? 0 : 1);
  const firstBinding = (workspaceId, onConflict) => bindings.withTransaction({ ...inWorkspace(workspaceId), retry: false }, (txOptions) =>
    bindings.createMany([{ scopeKey: "company", value: String(workspaceId) }], { ...txOptions, onConflict }));
  const writers = {
    // Each workspace's first binding for one scope key, in two neighbouring workspaces.
    ignore: (round, order, side) => firstBinding(neighbour(1000, round, order, side), { keys: ["workspaceId", "scopeKey"], action: "ignore" }),
    merge: (round, order, side) => firstBinding(neighbour(3000, round, order, side), { keys: ["workspaceId", "scopeKey"], action: "merge", merge: ["value"] })
  };
  const outcomes = {};
  for (const [name, write] of Object.entries(writers)) {
    for (let round = 10; round < 30; round += 1) {
      for (const order of ["ab", "ba"]) {
        const results = await Promise.all([...order].map((side) => outcomeOf(write(round, order, side))));
        for (const result of results) {
          const key = `${name} ${result}`;
          outcomes[key] = (outcomes[key] ?? 0) + 1;
        }
      }
    }
  }
  assert.deepEqual(outcomes, { "ignore saved": 80, "merge saved": 80 });
  assert.equal(Number((await knex("bindings").count({ count: "*" }).first()).count), 160);
});
