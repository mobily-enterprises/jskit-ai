import assert from "node:assert/strict";
import test from "node:test";
import { countQueries, requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";

// users.profiles.joinSource and users.settings.joinSource on a database of the test file's own (usersDatabases.js), run
// on MariaDB/MySQL and on PostgreSQL alike: another owner's report reads the users beside its own rows in one
// statement, through the users table's scope.

const identityOf = (tag) => ({
  authProvider: "local",
  authProviderUserSid: `identity-${tag}`,
  email: `${tag}@example.test`,
  displayName: tag,
  username: tag
});

/**
 * Registers the join source tests on `database`.
 * @param {{ open: () => Promise<any> }} database
 * @param {{ skip?: string | false }} [options]
 */
function joinSourceCases(database, { skip = false } = {}) {
  test("users.profiles and users.settings answer join sources a report reads in one statement, under the users table's row policy", { skip }, async () => {
    requireTestDatabase(process.env);
    const db = await database.open();
    const shown = await db.profiles.upsert(identityOf("join-shown"));
    const hidden = await db.profiles.upsert(identityOf("join-hidden"));
    await db.settings.ensureForUserId(shown.id);
    await db.settings.ensureForUserId(hidden.id);
    await db.knex("user_settings").where({ user_id: shown.id }).update({ locale: "en-GB" });
    await db.knex("user_settings").where({ user_id: hidden.id }).update({ locale: "it-IT" });
    // The users table owned again, with a row policy that hides one profile from every caller but background work.
    const narrowed = await db.ownedWith({
      rowPolicy: ({ query, column, caller }) => {
        if (caller.kind !== "system") query.whereNot(column("username"), hidden.username);
        return true;
      }
    });

    // A report beside the users: each listed user's display name and locale, the settings joined to the profiles.
    async function localesOf(options) {
      const people = await narrowed.profiles.joinSource({ alias: "u", filters: { id: [shown.id, hidden.id] } }, options);
      const settings = await narrowed.settings.joinSource({ alias: "s" }, options);
      const named = people.query.select({ id: people.column("id"), name: people.column("displayName") }).as("p");
      return settings.query
        .join(named, "p.id", settings.column("id"))
        .select({ name: "p.name", locale: settings.column("locale") })
        .orderBy("p.name");
    }
    const { result, count } = await countQueries(db.knex, () => localesOf({}));
    assert.deepEqual(result, [{ name: "join-shown", locale: "en-GB" }]);
    assert.equal(count, 1);
    assert.deepEqual(await localesOf({ context: narrowed.systemContext }),
      [{ name: "join-hidden", locale: "it-IT" }, { name: "join-shown", locale: "en-GB" }]);
    await assert.rejects(narrowed.profiles.joinSource({}, {}), /userProfiles\.joinSource\(\) needs the alias/u);
  });
}

export { joinSourceCases };
