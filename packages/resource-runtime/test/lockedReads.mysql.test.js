import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../src/test/index.js";
import { ownMysqlDatabase } from "./support/mysqlDatabase.js";

// What a lock's caller reads after the lock on MySQL and MariaDB, under InnoDB's REPEATABLE READ. A lock answers only
// the rows it locks and refuses include, so the related rows come from a plain read after it, and a plain read inside a
// transaction sees the snapshot of the transaction's first plain read: a transaction that locks first reads what the
// lock's previous holder committed, one that read before its lock does not.

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
const bookingResource = defineTableResource({
  name: "bookings",
  tableName: "bookings",
  ownership: "workspace",
  searchSchema: { seatIds: { type: "array", actualField: "seatId", filterOperator: "in" } },
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    seatId: { type: "id", required: true, storage: { column: "seat_id" } },
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
  await knex.schema.createTable("bookings", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.integer("seat_id").notNullable().index();
    table.string("guest").notNullable();
  });
  const runtime = await createTestResourceRuntime({ knex });
  return runtime.own("seats.feature", [seatResource, bookingResource]);
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
    await assert.rejects(seats.lock(seatId, { ...tx, include: ["bookings"] }), /seats\.lock\(\) locks only its own rows .* takes no include/u);
    const before = readFirst ? await guestsOf(tx) : null;
    // The holder commits only once the reader has made its plain read, or is about to lock.
    commit();
    await seats.lock(seatId, { ...tx, fields: ["code"] });
    return { before, after: await guestsOf(tx) };
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
