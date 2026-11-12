import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../src/test/index.js";
import { ownMysqlDatabase } from "./support/mysqlDatabase.js";

// What a lock's caller reads after the lock on MySQL and MariaDB, under InnoDB's REPEATABLE READ. A plain read inside a
// transaction sees the snapshot of the transaction's first plain read: a transaction that locks first reads what the
// lock's previous holder committed, one that read before its lock does not. A lock and the records its include names
// are locking reads, so they read what was committed whatever that snapshot holds.

const WORKSPACE = Object.freeze({ context: Object.freeze({ workspace: Object.freeze({ id: "1" }) }) });

const seatResource = defineTableResource({
  name: "seats",
  tableName: "seats",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    code: { type: "string", required: true }
  }
});
const ticketResource = defineTableResource({
  name: "tickets",
  tableName: "tickets",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    number: { type: "string", required: true }
  }
});
const bookingResource = defineTableResource({
  name: "bookings",
  tableName: "bookings",
  ownership: "workspace",
  searchSchema: { seatIds: { type: "array", actualField: "seatId", filterOperator: "in" } },
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    seatId: { type: "id", required: true, storage: { column: "seat_id" } },
    ticketId: { type: "id", nullable: true, belongsTo: "tickets", as: "ticket", storage: { column: "ticket_id" } },
    guest: { type: "string", required: true }
  }
});

async function database(t, suffix) {
  const knex = await ownMysqlDatabase(t, suffix);
  await knex.schema.createTable("seats", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("code").notNullable();
  });
  await knex.schema.createTable("tickets", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("number").notNullable();
  });
  await knex.schema.createTable("bookings", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.integer("seat_id").notNullable().index();
    table.integer("ticket_id").nullable();
    table.string("guest").notNullable();
    // lockWhere on MySQL reads through an index that starts with the ownership column.
    table.index(["workspace_id", "seat_id"]);
  });
  const runtime = await createTestResourceRuntime({ knex });
  return runtime.own("seats.feature", [seatResource, ticketResource, bookingResource]);
}

/**
 * One transaction holds a seat's lock and adds a booking for it; a second, the reader, locks the seat (waiting for
 * the holder's commit) and then reads the seat's bookings. With `readFirst` the reader makes a plain read before the
 * holder commits. Answers the reader's bookings before (readFirst only) and after its lock.
 */
async function readAfterLock(t, suffix, { readFirst }) {
  const { seats, bookings } = await database(t, suffix);
  const [seatId] = await seats.createMany([{ code: "A1" }], { ...WORKSPACE, returning: "ids" });
  const guestsOf = (tx) => bookings.queryAll({ filters: { seatIds: [seatId] }, fields: ["guest"] }, tx);
  let commit;
  const committing = new Promise((resolve) => {
    commit = resolve;
  });
  let holding;
  const held = new Promise((resolve) => {
    holding = resolve;
  });
  const holder = seats.withTransaction(WORKSPACE, async (tx) => {
    await seats.lock(seatId, { ...tx, fields: ["code"] });
    await bookings.create({ seatId, guest: "first" }, { ...tx, returning: "none" });
    holding();
    await committing;
  });
  await held;
  const reader = seats.withTransaction({ ...WORKSPACE, retry: false }, async (tx) => {
    try {
      await assert.rejects(seats.lock(seatId, { ...tx, include: ["bookings"] }), /seats\.lock\(\) includes "bookings", which is no belongs-to relationship of seats/u);
      const before = readFirst ? await guestsOf(tx) : null;
      // The holder commits only once the reader has made its plain read, or is about to lock.
      commit();
      await seats.lock(seatId, { ...tx, fields: ["code"] });
      return { before, after: await guestsOf(tx) };
    } finally {
      // A failed step still lets the holder finish, so the test fails rather than waits.
      commit();
    }
  });
  const [, read] = await Promise.all([holder, reader]);
  return { before: read.before?.map(({ guest }) => guest) ?? null, after: read.after.map(({ guest }) => guest) };
}

test("a transaction that locks first reads, after its lock, the rows the lock's previous holder committed", async (t) => {
  assert.deepEqual(await readAfterLock(t, "da_lr_lock", { readFirst: false }), { before: null, after: ["first"] });
});

test("a transaction that made a plain read before its lock still reads that read's snapshot after the lock", async (t) => {
  assert.deepEqual(await readAfterLock(t, "da_lr_read", { readFirst: true }), { before: [], after: [] });
});

test("a lock's include reads the records committed after the transaction's snapshot, which a plain read after the lock misses", async (t) => {
  const { seats, tickets, bookings } = await database(t, "da_lr_include");
  const [seatId] = await seats.createMany([{ code: "A1" }], { ...WORKSPACE, returning: "ids" });
  let commit;
  const committing = new Promise((resolve) => {
    commit = resolve;
  });
  let holding;
  const held = new Promise((resolve) => {
    holding = resolve;
  });
  // The holder locks the seat, then adds a ticket and a booking that names it.
  const holder = seats.withTransaction(WORKSPACE, async (tx) => {
    await seats.lock(seatId, { ...tx, fields: ["code"] });
    const ticket = await tickets.create({ number: "T1" }, { ...tx, returning: "id" });
    await bookings.create({ seatId, ticketId: ticket, guest: "first" }, { ...tx, returning: "none" });
    holding();
    await committing;
  });
  await held;
  // The reader's plain read takes its snapshot before the holder commits; its lock waits for the commit.
  const reader = seats.withTransaction({ ...WORKSPACE, retry: false }, async (tx) => {
    try {
      const before = await bookings.queryAll({ filters: { seatIds: [seatId] }, fields: ["guest"], include: ["ticket"] }, tx);
      commit();
      await seats.lock(seatId, { ...tx, fields: ["code"] });
      const locked = await bookings.lockWhere({ seatIds: [seatId] }, { ...tx, fields: ["guest"], include: ["ticket"] });
      const after = await bookings.queryAll({ filters: { seatIds: [seatId] }, fields: ["guest"], include: ["ticket"] }, tx);
      return { before, locked, after };
    } finally {
      commit();
    }
  });
  const [, read] = await Promise.all([holder, reader]);
  assert.deepEqual(read.before, []);
  assert.deepEqual(read.locked.map(({ guest, ticketId, ticket }) => [guest, ticketId !== null && ticketId === ticket?.id, ticket?.number ?? null]), [["first", true, "T1"]]);
  assert.deepEqual(read.after, []);
});

test("lock, lockMany and lockWhere with lockMode share let another transaction share-lock the row, and hold its writes and exclusive locks", async (t) => {
  const { seats, bookings } = await database(t, "da_lr_share");
  const [seatId] = await seats.createMany([{ code: "A1" }], { ...WORKSPACE, returning: "ids" });
  const bookingId = await bookings.create({ seatId, guest: "first" }, { ...WORKSPACE, returning: "id" });
  // What another transaction does while the row is held shared: it gives up after 1 s (ER_LOCK_WAIT_TIMEOUT) when it
  // would wait.
  const meanwhile = (work) => bookings.withTransaction({ ...WORKSPACE, retry: false }, async (tx) => {
    await tx.trx.raw("SET SESSION innodb_lock_wait_timeout = 1");
    await work(tx);
  }).then(() => "proceeds", (error) => error.code);
  const others = {
    "shared lock": (tx) => bookings.lock(bookingId, { ...tx, lockMode: "share" }),
    "exclusive lock": (tx) => bookings.lock(bookingId, tx),
    write: (tx) => bookings.patch(bookingId, { guest: "other" }, { ...tx, returning: "none" })
  };
  const lockers = {
    lock: (tx) => bookings.lock(bookingId, tx),
    lockMany: (tx) => bookings.lockMany([bookingId], tx),
    lockWhere: (tx) => bookings.lockWhere({ seatIds: [seatId] }, tx)
  };
  const outcomes = {};
  for (const [name, locker] of Object.entries(lockers)) {
    outcomes[name] = await bookings.withTransaction(WORKSPACE, async (tx) => {
      assert.deepEqual((await locker({ ...tx, lockMode: "share" })).length ?? 1, 1, name);
      const seen = {};
      for (const [what, work] of Object.entries(others)) {
        seen[what] = await meanwhile(work);
      }
      return seen;
    });
  }
  const shared = { "shared lock": "proceeds", "exclusive lock": "ER_LOCK_WAIT_TIMEOUT", write: "ER_LOCK_WAIT_TIMEOUT" };
  assert.deepEqual(outcomes, { lock: shared, lockMany: shared, lockWhere: shared });
  assert.deepEqual((await bookings.queryAll({}, WORKSPACE)).map(({ guest }) => guest), ["first"]);
});
