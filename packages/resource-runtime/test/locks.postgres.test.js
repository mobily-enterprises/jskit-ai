import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { createPackageTestKnex, createTestResourceRuntime } from "../src/test/index.js";

// The row locks, the many-row writes and the upserts on PostgreSQL, with real concurrent transactions: what an
// application on PostgreSQL relies on when two requests or two servers reach the same rows at once. Each test works in
// a schema of its own in TEST_DB_NAME (createPackageTestKnex); the other data tests of this package run here too on a
// DB_CLIENT=pg run, and the MySQL and MariaDB races are in manyRowWrites.mysql.test.js.

const skip = process.env.DB_CLIENT === "pg" ? false : "a PostgreSQL test: it runs on a DB_CLIENT=pg run, with TEST_DB_NAME";
const WORKSPACE = Object.freeze({ context: Object.freeze({ workspace: Object.freeze({ id: "1" }) }) });
const OTHER_WORKSPACE = Object.freeze({ context: Object.freeze({ workspace: Object.freeze({ id: "2" }) }) });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (work) => work().then((value) => ({ value }), (error) => ({ error }));

const slotResource = defineTableResource({
  name: "slots",
  tableName: "slots",
  ownership: "workspace",
  defaultSort: ["id"],
  schema: {
    id: { type: "id", primary: true },
    workspaceId: { type: "id", nullable: true, search: true, storage: { column: "workspace_id" } },
    code: { type: "string", nullable: true, search: true },
    status: { type: "string", defaultTo: "open", search: true },
    takenBy: { type: "string", nullable: true, storage: { column: "taken_by" } }
  }
});

// A table with no owners keyed by an id the server computes, as lockOrCreate and findOrCreate take.
const balanceResource = defineTableResource({
  name: "balances",
  tableName: "balances",
  ownership: "public",
  schema: {
    id: { type: "string", primary: true },
    amount: { type: "integer", defaultTo: 0 }
  }
});

async function database(t) {
  const knex = await createPackageTestKnex(t, { environment: process.env });
  await knex.schema.createTable("slots", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("code").nullable();
    table.string("status").notNullable().defaultTo("open");
    table.string("taken_by").nullable();
    table.unique(["workspace_id", "code"]);
  });
  await knex.schema.createTable("balances", (table) => {
    table.string("id").primary();
    table.integer("amount").notNullable().defaultTo(0);
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { slots, balances } = await runtime.own("slots.feature", [slotResource, balanceResource]);
  return { knex, slots, balances };
}

/**
 * Waits until `count` sessions wait, directly or behind another waiter, for the session `pid` (pg_blocking_pids).
 * @param {import("knex").Knex} knex
 * @param {number} pid
 * @param {number} count
 */
async function waitingBehind(knex, pid, count) {
  for (let waited = 0; waited < 10_000; waited += 25) {
    const { rows: [{ waiting }] } = await knex.raw(
      "WITH RECURSIVE blocked(pid) AS (" +
      "SELECT a.pid FROM pg_stat_activity a WHERE ? = ANY(pg_blocking_pids(a.pid)) " +
      "UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))" +
      ") SELECT count(*)::int AS waiting FROM blocked",
      [pid]
    );
    if (waiting >= count) return;
    await pause(25);
  }
  assert.fail(`${count} sessions did not wait for session ${pid} within 10 s`);
}

/**
 * Runs `hold(trx)` in a transaction of its own, then the writers, until all of them wait behind it; then ends it
 * (commits, or rolls back with `rollback`) and answers each writer's outcome.
 */
async function raceBehind(knex, hold, writers, { rollback = false } = {}) {
  const holder = await knex.transaction();
  try {
    const { rows: [{ pid }] } = await holder.raw("SELECT pg_backend_pid() AS pid");
    await hold(holder);
    const running = writers.map((write) => settle(write));
    await waitingBehind(knex, pid, writers.length);
    await (rollback ? holder.rollback() : holder.commit());
    return await Promise.all(running);
  } finally {
    if (!holder.isCompleted()) await holder.rollback();
  }
}

const noErrors = (outcomes) => assert.deepEqual(outcomes.filter(({ error }) => error).map(({ error }) => error.message), []);

test("of two concurrent patchWhere calls whose filters both matched one row, exactly one writes it", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  const [id] = await slots.createMany([{ status: "open" }], { ...WORKSPACE, returning: "ids" });
  const take = (taker) => () => slots.patchWhere({ id, status: "open" }, { status: "taken", takenBy: taker }, { ...WORKSPACE, returning: "ids" });
  const outcomes = await raceBehind(knex, (holder) => holder("slots").where({ id }).forUpdate().select("id"), [take("first"), take("second")]);
  noErrors(outcomes);
  assert.deepEqual(outcomes.map(({ value }) => value.length).sort(), [0, 1], "exactly one writer takes the row");
  const row = await knex("slots").where({ id }).first("status", "taken_by");
  assert.deepEqual([row.status, row.taken_by], ["taken", outcomes[0].value.length === 1 ? "first" : "second"]);
});

test("a deleteWhere whose filter matched a row a concurrent patchWhere changed leaves it in place", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  const [id] = await slots.createMany([{ status: "open" }], { ...WORKSPACE, returning: "ids" });
  const outcomes = await raceBehind(knex, (holder) => holder("slots").where({ id }).forUpdate().select("id"), [
    () => slots.patchWhere({ id, status: "open" }, { status: "taken", takenBy: "first" }, { ...WORKSPACE, returning: "ids" }),
    () => slots.deleteWhere({ id, status: "open" }, { ...WORKSPACE, returning: "ids" })
  ]);
  noErrors(outcomes);
  const [patched, deleted] = outcomes.map(({ value }) => value.length);
  const row = await knex("slots").where({ id }).first("status");
  assert.deepEqual([patched + deleted, row ? row.status : "deleted"], [1, patched === 1 ? "taken" : "deleted"]);
});

test("a patchWhere that waited for a row changed meanwhile writes only the rows that still match", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  const ids = await slots.createMany([{ status: "open" }, { status: "open" }, { status: "open" }], { ...WORKSPACE, returning: "ids" });
  const [outcome] = await raceBehind(
    knex,
    (holder) => holder("slots").where({ id: ids[1] }).update({ status: "taken", taken_by: "holder" }),
    [() => slots.patchWhere({ status: "open" }, { status: "closed" }, { ...WORKSPACE, returning: "ids" })]
  );
  noErrors([outcome]);
  assert.deepEqual(outcome.value.map(String).sort(), [ids[0], ids[2]].map(String).sort());
  assert.deepEqual((await knex("slots").orderBy("id").pluck("status")), ["closed", "taken", "closed"]);
});

test("two workers claiming at once take different rows, and skip a row another transaction holds", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  const ids = (await slots.createMany([{ status: "open" }, { status: "open" }, { status: "open" }, { status: "open" }], { ...WORKSPACE, returning: "ids" })).map(String);
  await slots.createMany([{ status: "open" }], { ...OTHER_WORKSPACE, returning: "none" });
  const holder = await knex.transaction();
  t.after(() => (holder.isCompleted() ? undefined : holder.rollback()));
  await holder("slots").where({ id: ids[0] }).forUpdate().select("id");

  const first = Promise.withResolvers();
  const release = Promise.withResolvers();
  const claimNext = (take) => (txOptions) => slots.claim({ filters: { status: "open" }, sort: ["id"], take }, txOptions);
  const worker = slots.withTransaction(WORKSPACE, async (txOptions) => {
    const claimed = await claimNext(1)(txOptions);
    first.resolve(claimed.map(({ id }) => String(id)));
    await release.promise;
    await slots.patchWhere({ id: claimed.map(({ id }) => id) }, { status: "taken", takenBy: "first" }, txOptions);
    return claimed;
  });
  assert.deepEqual(await first.promise, [ids[1]], "the first worker skips the row the holder locked");
  // While the first worker holds its row, the second takes the rest, never the held ones nor another workspace's.
  const second = await slots.withTransaction(WORKSPACE, async (txOptions) => (await claimNext(10)(txOptions)).map(({ id }) => String(id)));
  assert.deepEqual(second, [ids[2], ids[3]]);
  release.resolve();
  await worker;
  await holder.rollback();
  assert.deepEqual((await knex("slots").where({ workspace_id: 1 }).orderBy("id").pluck("status")), ["open", "taken", "open", "open"]);
});

test("a claim leaves a row whose committed change stopped it matching while the claim waited, and takes the next", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  const ids = (await slots.createMany([{ status: "open" }, { status: "open" }], { ...WORKSPACE, returning: "ids" })).map(String);
  // A claim never waits (SKIP LOCKED): the held row is skipped, and once its holder commits a change, it no longer matches.
  const holder = await knex.transaction();
  t.after(() => (holder.isCompleted() ? undefined : holder.rollback()));
  await holder("slots").where({ id: ids[0] }).update({ status: "taken" });
  const during = await slots.withTransaction(WORKSPACE, async (txOptions) => (await slots.claim({ filters: { status: "open" } }, txOptions)).map(({ id }) => String(id)));
  await holder.commit();
  const after = await slots.withTransaction(WORKSPACE, async (txOptions) => (await slots.claim({ filters: { status: "open" }, take: 5 }, txOptions)).map(({ id }) => String(id)));
  assert.deepEqual([during, after], [[ids[1]], [ids[1]]]);
});

test("lockMany waits for another transaction's lock, then reads the rows as it committed them, in id order", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  const ids = (await slots.createMany([{ status: "open" }, { status: "open" }, { status: "open" }], { ...WORKSPACE, returning: "ids" })).map(String);
  const [theirs] = (await slots.createMany([{ status: "open" }], { ...OTHER_WORKSPACE, returning: "ids" })).map(String);
  const [outcome] = await raceBehind(
    knex,
    (holder) => holder("slots").where({ id: ids[1] }).update({ status: "taken", taken_by: "holder" }),
    [() => slots.withTransaction(WORKSPACE, (txOptions) => slots.lockMany([ids[2], theirs, ids[1], ids[0]], { ...txOptions, missing: "skip" }))]
  );
  noErrors([outcome]);
  assert.deepEqual(outcome.value.map(({ id, status }) => [String(id), status]), [[ids[0], "open"], [ids[1], "taken"], [ids[2], "open"]]);
});

test("a lockWhere that waited also locks a row that started to match while it waited", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  const ids = (await slots.createMany([{ status: "open" }, { status: "taken" }, { status: "taken" }], { ...WORKSPACE, returning: "ids" })).map(String);
  const [outcome] = await raceBehind(
    knex,
    (holder) => holder("slots").whereIn("id", [ids[0], ids[1]]).update({ status: "open" }),
    [() => slots.withTransaction(WORKSPACE, (txOptions) => slots.lockWhere({ status: "open" }, txOptions))]
  );
  noErrors([outcome]);
  assert.deepEqual(outcome.value.map(({ id }) => String(id)), [ids[0], ids[1]]);
});

test("two upserts of one key behind an uncommitted insert of it both succeed, and the key has one row", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  const upsert = (action, takenBy) => () => slots.createMany(
    [{ code: "a", status: "open", takenBy }],
    { ...WORKSPACE, onConflict: { keys: ["workspaceId", "code"], action }, returning: "ids" }
  );
  for (const [action, expected] of [["ignore", ["holder"]], ["merge", ["first", "second"]]]) {
    await knex("slots").del();
    const outcomes = await raceBehind(
      knex,
      (holder) => holder("slots").insert({ workspace_id: 1, code: "a", status: "open", taken_by: "holder" }),
      [upsert(action, "first"), upsert(action, "second")],
      { rollback: action === "merge" }
    );
    noErrors(outcomes);
    const rows = await knex("slots").where({ workspace_id: 1, code: "a" }).select("taken_by");
    assert.equal(rows.length, 1, `${action}: one row for the key`);
    assert.ok(expected.includes(rows[0].taken_by), `${action}: kept ${rows[0].taken_by}`);
  }
  // The same key in another workspace is that workspace's own row.
  await slots.createMany([{ code: "a", status: "open" }], { ...OTHER_WORKSPACE, onConflict: { keys: ["workspaceId", "code"], action: "ignore" } });
  assert.equal((await knex("slots").where({ code: "a" })).length, 2);
});

test("two transactions that lock two rows in opposite orders deadlock, and the victim runs again and commits", { skip }, async (t) => {
  const { slots } = await database(t);
  const [a, b] = (await slots.createMany([{ status: "open" }, { status: "open" }], { ...WORKSPACE, returning: "ids" })).map(String);
  const locked = { first: Promise.withResolvers(), second: Promise.withResolvers() };
  let runs = 0;
  const work = (mine, theirs, name, other) => slots.withTransaction(WORKSPACE, async (txOptions) => {
    runs += 1;
    await slots.lock(mine, txOptions);
    locked[name].resolve();
    await locked[other].promise;
    await slots.lock(theirs, txOptions);
    await slots.patch(mine, { takenBy: name }, { ...txOptions, returning: "none" });
  });
  noErrors(await Promise.all([settle(() => work(a, b, "first", "second")), settle(() => work(b, a, "second", "first"))]));
  assert.equal(runs, 3, "the deadlock victim's work ran once more");
  assert.deepEqual((await slots.queryAll({ filters: { id: [a, b] } }, WORKSPACE)).map(({ takenBy }) => takenBy), ["first", "second"]);
});

test("a transaction whose insert lost a unique race runs once more and finds the winner's row", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  let runs = 0;
  const record = (takenBy) => () => retryLostInsertRace(WORKSPACE, () => slots.withTransaction(WORKSPACE, async (txOptions) => {
    runs += 1;
    const [found] = await slots.queryAll({ filters: { code: "k" } }, txOptions);
    return found ?? slots.create({ code: "k", status: "taken", takenBy }, txOptions);
  }));
  const outcomes = await raceBehind(
    knex,
    (holder) => holder("slots").insert({ workspace_id: 1, code: "k", status: "open", taken_by: "holder" }),
    [record("first"), record("second")],
    { rollback: true }
  );
  noErrors(outcomes);
  const [first, second] = outcomes.map(({ value }) => value);
  assert.equal(String(first.id), String(second.id), "both answer the one row");
  assert.equal(runs, 3, "the loser ran once more");
  assert.equal((await knex("slots").where({ code: "k" })).length, 1);
});

test("findOrCreate of one id at once, behind an uncommitted insert of it, answers one record to both", { skip }, async (t) => {
  const { knex, balances } = await database(t);
  const outcomes = await raceBehind(
    knex,
    (holder) => holder("balances").insert({ id: "acct-1", amount: 7 }),
    [() => balances.findOrCreate({ id: "acct-1", amount: 1 }, WORKSPACE), () => balances.findOrCreate({ id: "acct-1", amount: 2 }, WORKSPACE)],
    { rollback: true }
  );
  noErrors(outcomes);
  const [first, second] = outcomes.map(({ value }) => value);
  assert.deepEqual([first.id, second.id, first.amount], ["acct-1", "acct-1", second.amount]);
  assert.deepEqual(await knex("balances").pluck("id"), ["acct-1"]);
});

test("first uses of one id at once through lockOrCreate create one record and run every work once, one at a time", { skip }, async (t) => {
  const { balances } = await database(t);
  let works = 0;
  let inside = 0;
  let overlapped = false;
  const add = () => balances.lockOrCreate({ id: "acct-2", amount: 0 }, WORKSPACE, async (record, txOptions) => {
    works += 1;
    inside += 1;
    overlapped ||= inside > 1;
    await pause(20);
    await balances.patch(record.id, { amount: record.amount + 1 }, { ...txOptions, returning: "none" });
    inside -= 1;
  });
  noErrors(await Promise.all(Array.from({ length: 4 }, () => settle(add))));
  assert.equal(works, 4);
  assert.equal(overlapped, false, "the lock serializes the works");
  assert.equal((await balances.get("acct-2", {}, WORKSPACE)).amount, 4);
});

test("a lock or patchWhere with lockMode noKeyUpdate lets another transaction add a row that references the locked one; the default lock does not", { skip }, async (t) => {
  const { knex, slots, balances } = await database(t);
  await knex.schema.createTable("entries", (table) => {
    table.increments("id");
    table.integer("slot_id").nullable().references("id").inTable("slots");
    table.string("balance_id").nullable().references("id").inTable("balances");
  });
  const [slot] = await slots.createMany([{ status: "open" }], { ...WORKSPACE, returning: "ids" });
  await balances.createMany([{ id: "acct-3", amount: 0 }], { ...WORKSPACE, returning: "none" });
  // Another transaction adds a row that references the locked one. Its foreign key check takes FOR KEY SHARE on the
  // locked row, which FOR NO KEY UPDATE lets through and FOR UPDATE does not; it gives up after 500 ms (55P03).
  const addEntry = async (entry) => {
    const { error } = await settle(() => knex.transaction(async (trx) => {
      await trx.raw("SET LOCAL lock_timeout = '500ms'");
      await trx("entries").insert(entry);
    }));
    return error ? error.code : "added";
  };
  const lockers = {
    lock: (txOptions) => slots.lock(slot, txOptions),
    lockMany: (txOptions) => slots.lockMany([slot], txOptions),
    lockWhere: (txOptions) => slots.lockWhere({ status: "open" }, txOptions),
    claim: (txOptions) => slots.claim({ filters: { status: "open" } }, txOptions),
    patchWhere: (txOptions) => slots.patchWhere({ status: "open" }, { takenBy: "worker" }, txOptions)
  };
  const outcomes = {};
  for (const [name, locker] of Object.entries(lockers)) {
    for (const mode of ["noKeyUpdate", "update"]) {
      outcomes[`${name} ${mode}`] = await slots.withTransaction(WORKSPACE, async (txOptions) => {
        await locker(mode === "update" ? txOptions : { ...txOptions, lockMode: mode });
        return addEntry({ slot_id: slot });
      });
    }
  }
  for (const mode of ["noKeyUpdate", "update"]) {
    const options = mode === "update" ? WORKSPACE : { ...WORKSPACE, lockMode: mode };
    outcomes[`lockOrCreate ${mode}`] = await balances.lockOrCreate({ id: "acct-3", amount: 0 }, options, () => addEntry({ balance_id: "acct-3" }));
  }
  assert.deepEqual(outcomes, Object.fromEntries([...Object.keys(lockers), "lockOrCreate"].flatMap((name) => [
    [`${name} noKeyUpdate`, "added"],
    [`${name} update`, "55P03"]
  ])));
  assert.equal(Number((await knex("entries").count({ count: "*" }).first()).count), 6);
});

test("lock, lockMany and lockWhere with lockMode share let another transaction read and share-lock the row, and hold its writes and exclusive locks", { skip }, async (t) => {
  const { knex, slots } = await database(t);
  const [slot] = (await slots.createMany([{ status: "open" }], { ...WORKSPACE, returning: "ids" })).map(String);
  // What another transaction does while the row is held shared: it gives up after 500 ms (55P03) when it would wait.
  const meanwhile = async (work) => {
    const { error } = await settle(() => knex.transaction(async (trx) => {
      await trx.raw("SET LOCAL lock_timeout = '500ms'");
      await work(trx);
    }));
    return error ? error.code : "proceeds";
  };
  const others = {
    read: (trx) => trx("slots").where({ id: slot }),
    "shared lock": (trx) => trx("slots").where({ id: slot }).forShare(),
    "exclusive lock": (trx) => trx("slots").where({ id: slot }).forUpdate(),
    write: (trx) => trx("slots").where({ id: slot }).update({ taken_by: "other" })
  };
  const lockers = {
    lock: (txOptions) => slots.lock(slot, txOptions),
    lockMany: (txOptions) => slots.lockMany([slot], txOptions),
    lockWhere: (txOptions) => slots.lockWhere({ status: "open" }, txOptions)
  };
  const outcomes = {};
  for (const [name, locker] of Object.entries(lockers)) {
    const statements = [];
    const recorded = ({ sql }) => statements.push(sql);
    outcomes[name] = await slots.withTransaction(WORKSPACE, async (txOptions) => {
      knex.on("query", recorded);
      try {
        await locker({ ...txOptions, lockMode: "share" });
      } finally {
        knex.off("query", recorded);
      }
      assert.ok(statements.some((sql) => /\bfor share\b/iu.test(sql)) && !statements.some((sql) => /\bfor (?:no key )?update\b/iu.test(sql)), `${name}: ${statements.join(" | ")}`);
      const seen = {};
      for (const [what, work] of Object.entries(others)) {
        seen[what] = await meanwhile(work);
      }
      return seen;
    });
  }
  const shared = { read: "proceeds", "shared lock": "proceeds", "exclusive lock": "55P03", write: "55P03" };
  assert.deepEqual(outcomes, { lock: shared, lockMany: shared, lockWhere: shared });
  assert.equal((await knex("slots").where({ id: slot }).first()).taken_by, null);
});
