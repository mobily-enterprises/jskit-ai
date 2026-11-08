import assert from "node:assert/strict";
import test from "node:test";
import { countQueries, requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";

// users.profiles.listByIds and users.settings.listByUserIds on a database of the test file's own (usersDatabases.js),
// run on MariaDB/MySQL and on PostgreSQL alike: more ids than one page of query in one call, an id named twice, and
// ids the caller cannot see.

const identityOf = (tag, extra = {}) => ({
  authProvider: "local",
  authProviderUserSid: `identity-${tag}`,
  email: `${tag}@example.test`,
  displayName: tag,
  username: tag,
  ...extra
});

// Ids in numeric order, as the users table sorts them.
const numerically = (left, right) => (BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);

/**
 * Registers the listByIds and listByUserIds tests on `database`.
 * @param {{ open: () => Promise<any> }} database
 * @param {{ skip?: string | false }} [options]
 */
function listByIdsCases(database, { skip = false } = {}) {
  test("listByIds answers every profile of 1,205 ids in one call, sorted by id, in one statement per 1,000 ids", { skip }, async () => {
    requireTestDatabase(process.env);
    const db = await database.open();
    const ids = await db.profiles.createManyIgnoringExisting(
      Array.from({ length: 1205 }, (_, index) => identityOf(`many-${index}`)),
      { context: db.systemContext }
    );
    assert.equal(ids.length, 1205);

    const { result, count } = await countQueries(db.knex, () => db.profiles.listByIds([...ids].reverse()));
    assert.deepEqual(result.map(({ id }) => id), [...ids].sort(numerically));
    assert.equal(count, 2, "1,205 ids are read in two statements, never one per page of 100 or per id");
    assert.deepEqual(result[0], await db.profiles.findById(result[0].id), "each profile reads as findById answers it");
  });

  test("listByIds answers a profile named twice once, and leaves out ids naming no profile and values that are no id", { skip }, async () => {
    requireTestDatabase(process.env);
    const db = await database.open();
    const one = await db.profiles.upsert(identityOf("ids-one"));
    const two = await db.profiles.upsert(identityOf("ids-two"));
    const { result, count } = await countQueries(db.knex, () => db.profiles.listByIds([
      two.id, ` ${one.id} `, Number(two.id), one.id, "999999999", "not-an-id", `0${one.id}`, 0, -1, null, undefined
    ]));
    assert.deepEqual(result.map(({ id }) => id), [one.id, two.id]);
    assert.deepEqual(result, [await db.profiles.findById(one.id), await db.profiles.findById(two.id)]);
    assert.equal(count, 1);

    assert.deepEqual(await countQueries(db.knex, () => db.profiles.listByIds([])), { result: [], count: 0, queries: [] });
    assert.deepEqual(await db.profiles.listByIds(["999999999", "not-an-id"]), []);
    await assert.rejects(db.profiles.listByIds(one.id), /listByIds takes an array of user ids/u);
  });

  test("listByIds sees what query sees for the caller, and joins the caller's transaction", { skip }, async () => {
    requireTestDatabase(process.env);
    const db = await database.open();
    const shown = await db.profiles.upsert(identityOf("ids-shown"));
    const hidden = await db.profiles.upsert(identityOf("ids-hidden"));
    const ids = [hidden.id, shown.id];
    // The users table owned again, with a row policy that hides one profile from every caller but background work.
    const narrowed = await db.ownedWith({
      rowPolicy: ({ query, column, caller }) => {
        if (caller.kind !== "system") query.whereNot(column("username"), hidden.username);
        return true;
      }
    });

    const { records } = await narrowed.profiles.query({ filters: { id: ids }, page: { size: 10 } }, {});
    assert.deepEqual(records.map(({ id }) => id), [shown.id]);
    assert.deepEqual((await narrowed.profiles.listByIds(ids)).map(({ id }) => id), [shown.id]);
    assert.deepEqual(
      (await narrowed.profiles.listByIds(ids, { context: narrowed.systemContext })).map(({ id }) => id),
      [shown.id, hidden.id].sort(numerically)
    );

    // A profile created in the caller's transaction is listed inside it, and is gone once the transaction rolls back.
    const abort = new Error("Abort");
    let created = null;
    await assert.rejects(db.profiles.withTransaction({}, async (txOptions) => {
      created = await db.profiles.upsert(identityOf("ids-uncommitted"), txOptions);
      assert.deepEqual((await db.profiles.listByIds([created.id, shown.id], txOptions)).map(({ id }) => id), [shown.id, created.id]);
      throw abort;
    }), (error) => error === abort);
    assert.deepEqual((await db.profiles.listByIds([created.id, shown.id])).map(({ id }) => id), [shown.id]);
  });

  test("settings.listByUserIds answers each listed user's settings once, sorted by user id, as findByUserId reads them", { skip }, async () => {
    requireTestDatabase(process.env);
    const db = await database.open();
    const one = await db.profiles.upsert(identityOf("settings-one"));
    const two = await db.profiles.upsert(identityOf("settings-two"));
    const unset = await db.profiles.upsert(identityOf("settings-unset"));
    await db.settings.ensureForUserId(one.id);
    await db.settings.ensureForUserId(two.id);
    // A row saved before locales were canonical.
    await db.knex("user_settings").where({ user_id: two.id }).update({ locale: "en-us" });

    const { result, count } = await countQueries(db.knex, () => db.settings.listByUserIds([
      two.id, unset.id, ` ${one.id} `, two.id, "not-an-id", null
    ]));
    assert.deepEqual(result, [await db.settings.findByUserId(one.id), await db.settings.findByUserId(two.id)]);
    assert.equal(result[1].locale, "en-US");
    assert.equal(count, 1, "one statement, never one per user");

    assert.deepEqual(await countQueries(db.knex, () => db.settings.listByUserIds([])), { result: [], count: 0, queries: [] });
    await assert.rejects(db.settings.listByUserIds(one.id), /listByUserIds takes an array of user ids/u);
  });
}

export { listByIdsCases };
