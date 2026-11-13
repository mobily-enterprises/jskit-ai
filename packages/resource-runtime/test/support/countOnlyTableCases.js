import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../../src/test/index.js";

// A table its feature counts but never reads back row by row (who took part in an anonymous survey): each row takes a
// random v4 uuid the caller makes, never a sequence, and a unique key on the workspace, the record and the user. A
// duplicate create hits that key. createMany's onConflict ignore makes a duplicate by those keys a no-op that keeps the
// stored id, gives a new row the id it brings, and fails on an id that is already another row's: the ignore covers only
// a clash on the keys' unique index, on MySQL and MariaDB as elsewhere. Each database's test file runs these cases on
// its own connection.

const WORKSPACE_A = Object.freeze({ context: Object.freeze({ workspace: Object.freeze({ id: "1" }) }) });
const WORKSPACE_B = Object.freeze({ context: Object.freeze({ workspace: Object.freeze({ id: "2" }) }) });
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const KEYS = Object.freeze(["workspaceId", "recordId", "userId"]);
const IGNORE = Object.freeze({ keys: KEYS, action: "ignore" });

// A unique key's violation, as each driver reports it, anywhere in the error's causes.
const DUPLICATE_CODES = new Set(["23505", "ER_DUP_ENTRY", "SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"]);
function duplicateKey(error) {
  for (let current = error; current; current = current.cause) {
    if (DUPLICATE_CODES.has(current.code)) {
      return true;
    }
  }
  return false;
}

const participationResource = defineTableResource({
  name: "participations",
  tableName: "participations",
  ownership: "workspace",
  schema: {
    id: { type: "uuid", primary: true },
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    recordId: { type: "integer", required: true, search: true, storage: { column: "record_id" } },
    userId: { type: "integer", required: true, search: true, storage: { column: "user_id" } }
  }
});

/** @param {import("knex").Knex} knex */
async function participationsOf(knex) {
  await knex.schema.createTable("participations", (table) => {
    table.uuid("id").primary();
    table.integer("workspace_id").notNullable();
    table.integer("record_id").notNullable();
    table.integer("user_id").notNullable();
    table.unique(["workspace_id", "record_id", "user_id"]);
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { participations } = await runtime.own("survey.feature", [participationResource]);
  return participations;
}

/** The stored rows as `[id, workspace, user]`, by workspace and user. @param {import("knex").Knex} knex */
async function storedRows(knex) {
  const rows = await knex("participations").orderBy(["workspace_id", "user_id"]).select("id", "workspace_id", "user_id");
  return rows.map((row) => [String(row.id), Number(row.workspace_id), Number(row.user_id)]);
}

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function countOnlyTableCases(connect) {
  return [
    ["a count-only table takes the caller's random v4 ids in a member's request, refuses a duplicate by its unique key, and answers counts", async (t) => {
      const knex = await connect(t, "da_co_create");
      const participations = await participationsOf(knex);
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      await participations.create({ id: ids[0], recordId: 7, userId: 1 }, { ...WORKSPACE_A, returning: "none" });
      await participations.create({ id: ids[1], recordId: 7, userId: 2 }, { ...WORKSPACE_A, returning: "none" });
      await participations.create({ id: ids[2], recordId: 7, userId: 1 }, { ...WORKSPACE_B, returning: "none" });
      // The same person twice for one record hits the unique key.
      await assert.rejects(participations.create({ id: randomUUID(), recordId: 7, userId: 1 }, { ...WORKSPACE_A, returning: "none" }), duplicateKey);
      assert.deepEqual(await storedRows(knex), [[ids[0], 1, 1], [ids[1], 1, 2], [ids[2], 2, 1]]);
      assert.ok(ids.every((id) => V4.test(id)));
      const [counted] = await participations.aggregate({ measures: { participants: { count: "*" } }, filters: { recordId: 7 } }, WORKSPACE_A);
      assert.equal(counted.participants, 2);
    }],

    ["onConflict ignore keeps a duplicate's stored id, gives a new row its own id, and fails on an id that is another row's", async (t) => {
      const knex = await connect(t, "da_co_ignore");
      const participations = await participationsOf(knex);
      const first = randomUUID();
      const fresh = randomUUID();
      await participations.createMany([{ id: first, recordId: 7, userId: 1 }], { ...WORKSPACE_A, onConflict: IGNORE });
      // A duplicate by the keys writes nothing and keeps the stored id; a new row takes the id it brings.
      await participations.createMany([{ id: randomUUID(), recordId: 7, userId: 1 }, { id: fresh, recordId: 7, userId: 2 }], { ...WORKSPACE_A, onConflict: IGNORE });
      assert.deepEqual(await storedRows(knex), [[first, 1, 1], [fresh, 1, 2]]);
      // An id that is already another row's, with other keys, fails loudly, in its workspace and in another.
      for (const options of [WORKSPACE_A, WORKSPACE_B]) {
        await assert.rejects(participations.createMany([{ id: first, recordId: 8, userId: 3 }], { ...options, onConflict: IGNORE }), duplicateKey, options.context.workspace.id);
      }
      assert.deepEqual(await storedRows(knex), [[first, 1, 1], [fresh, 1, 2]]);
      // Inside one transaction the second ignore is a no-op too, and the transaction goes on.
      await participations.withTransaction(WORKSPACE_A, async (tx) => {
        await participations.createMany([{ id: randomUUID(), recordId: 9, userId: 1 }], { ...tx, onConflict: IGNORE });
        await participations.createMany([{ id: randomUUID(), recordId: 9, userId: 1 }], { ...tx, onConflict: IGNORE });
        await participations.createMany([{ id: randomUUID(), recordId: 9, userId: 2 }], { ...tx, onConflict: IGNORE });
      });
      const [counted] = await participations.aggregate({ measures: { participants: { count: "*" } }, filters: { recordId: 9 } }, WORKSPACE_A);
      assert.equal(counted.participants, 2);
      // A merge still takes rows without an id: the keys find the row it changes.
      await assert.rejects(participations.createMany([{ id: randomUUID(), recordId: 7, userId: 1 }], { ...WORKSPACE_A, onConflict: { keys: KEYS, action: "merge" } }),
        /onConflict merge takes rows without an id/u);
    }]
  ];
}

export { countOnlyTableCases };
