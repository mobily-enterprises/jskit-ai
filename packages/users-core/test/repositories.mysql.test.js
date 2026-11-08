import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { findDuplicateEntryError } from "@jskit-ai/database-runtime/shared";
import { createRepository as createUserProfilesRepository } from "../src/server/common/repositories/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "../src/server/common/repositories/userSettingsRepository.js";
import { DEFAULT_USER_SETTINGS } from "../src/shared/settings.js";
import { usersDatabase } from "./support/usersDatabases.js";

// users.profiles and users.settings on MariaDB/MySQL, on the users and user_settings table handles: the records
// they answer, the username a new profile gets, transactions, and a standalone insert that loses a race.
const database = usersDatabase("users_repos");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const identityOf = (tag, extra = {}) => ({
  authProvider: "local",
  authProviderUserSid: `identity-${tag}`,
  email: `${tag}@example.test`,
  displayName: tag,
  ...extra
});

// A profile row written past the repository, as another request would have.
async function insertProfile(db, tag, extra = {}) {
  const [id] = await db.knex("users").insert({
    auth_provider: "local",
    auth_provider_user_sid: `identity-${tag}`,
    email: `${tag}@example.test`,
    username: tag,
    display_name: tag,
    ...extra
  });
  return String(id);
}

// The statements a call sends.
async function statementsOf(db, work) {
  let count = 0;
  const listener = () => { count += 1; };
  db.knex.on("query", listener);
  try {
    return { result: await work(), count };
  } finally {
    db.knex.off("query", listener);
  }
}

test("withTransaction answers its work's value, commits with it and rolls back with it", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  for (const repository of [db.profiles, db.settings]) {
    assert.deepEqual(await repository.withTransaction({}, async () => ({ answered: true })), { answered: true });
    const failure = new Error("Participant failed");
    // The managed transaction rolls back, and the participant's own failure reaches the caller.
    await assert.rejects(repository.withTransaction({}, async () => { throw failure; }), (error) => error === failure);
  }
  const failure = new Error("Abort");
  await assert.rejects(db.profiles.withTransaction({}, async (txOptions) => {
    await db.profiles.createWithSettings({ profile: identityOf("rolled") }, txOptions);
    throw failure;
  }), (error) => error === failure);
  assert.equal(await db.profiles.findByIdentity({ provider: "local", providerUserId: "identity-rolled" }), null);
  const kept = await db.profiles.withTransaction({}, (txOptions) => db.profiles.createWithSettings({
    profile: identityOf("kept"),
    settings: { theme: "dark" }
  }, txOptions));
  assert.equal(kept.settings.theme, "dark");
  assert.equal((await db.settings.findByUserId(kept.profile.id)).theme, "dark");
});

test("a profile reads back normalized, by id, email or identity; an unknown one is null", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const created = await db.profiles.upsert(identityOf("reads", { email: " Reads@Example.TEST ", authProvider: " LOCAL " }));
  assert.deepEqual(Object.keys(created), [
    "id", "authProvider", "authProviderUserSid", "email", "username", "displayName",
    "avatarStorageKey", "avatarVersion", "avatarUpdatedAt", "createdAt", "updatedAt"
  ]);
  assert.match(created.id, /^\d+$/u);
  assert.equal(created.email, "reads@example.test");
  assert.equal(created.authProvider, "local");
  assert.equal(created.username, "reads", "the username comes from the email's local part");
  assert.match(created.createdAt, ISO);
  assert.equal(created.avatarStorageKey, null);

  assert.deepEqual(await db.profiles.findById(created.id), created);
  assert.deepEqual(await db.profiles.findByEmail(" READS@example.test "), created);
  assert.deepEqual(await db.profiles.findByIdentity({ provider: " Local ", providerUserId: "identity-reads" }), created);
  assert.equal(await db.profiles.findByEmail("nobody@example.test"), null);
  assert.equal(await db.profiles.findById("999999999"), null);
  assert.equal(await db.profiles.findById("not-an-id"), null);
  assert.equal(await db.profiles.findByIdentity({ provider: "local", providerUserId: "nobody" }), null);
});

test("an upsert of a known identity patches its email and name and keeps its username", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const created = await db.profiles.upsert(identityOf("renamed"));
  const updated = await db.profiles.upsert(identityOf("renamed", {
    email: " RENAMED.NEW@EXAMPLE.TEST ",
    displayName: "Renamed Again",
    username: "ignored"
  }));
  assert.equal(updated.id, created.id);
  assert.equal(updated.email, "renamed.new@example.test");
  assert.equal(updated.displayName, "Renamed Again");
  assert.equal(updated.username, "renamed");
  assert.match(updated.updatedAt, ISO);
  await assert.rejects(db.profiles.upsert({ authProvider: "local", email: "x@example.test", displayName: "x" }),
    /upsert requires provider\/authProvider and providerUserId\/authProviderUserSid\./u);
  await assert.rejects(db.profiles.upsert({ authProvider: "local", authProviderUserSid: "x", displayName: "x" }),
    /upsert requires email and displayName\./u);
});

test("the display name and avatar updates answer the changed profile", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const created = await db.profiles.upsert(identityOf("avatar"));
  assert.equal((await db.profiles.updateDisplayNameById(created.id, "Avatar Person")).displayName, "Avatar Person");
  const avatarUpdatedAt = new Date("2026-04-21T12:00:00.000Z");
  const withAvatar = await db.profiles.updateAvatarById(created.id, {
    avatarStorageKey: "avatars/1.png",
    avatarVersion: "v1",
    avatarUpdatedAt
  });
  assert.equal(withAvatar.avatarStorageKey, "avatars/1.png");
  assert.equal(withAvatar.avatarVersion, "v1");
  assert.equal(withAvatar.avatarUpdatedAt, avatarUpdatedAt.toISOString());
  assert.match(withAvatar.updatedAt, ISO);
  const cleared = await db.profiles.clearAvatarById(created.id);
  assert.deepEqual([cleared.avatarStorageKey, cleared.avatarVersion, cleared.avatarUpdatedAt], [null, null, null]);
  assert.equal(await db.profiles.updateDisplayNameById("", "Nobody"), null);
});

test("a new profile gets the first free username of base, base-2 to base-1000, in the same statements however many are taken", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const first = await statementsOf(db, () => db.profiles.upsert(identityOf("ada-one", { email: "ada@one.example.test" })));
  assert.equal(first.result.username, "ada");
  await insertProfile(db, "ada-3", { email: "ada-3@example.test" });
  await insertProfile(db, "ada-2", { email: "ada-2@example.test" });
  const third = await statementsOf(db, () => db.profiles.upsert(identityOf("ada-two", { email: "ada@two.example.test" })));
  assert.equal(third.result.username, "ada-4");
  assert.equal(third.count, first.count, `${first.count} and ${third.count} statements`);
  assert.equal((await db.profiles.upsert(identityOf("ada-three", { email: "x@three.example.test", username: "Ada" }))).username,
    "ada-5", "a requested username is the base");

  const longLocal = "b".repeat(130);
  assert.equal((await db.profiles.upsert(identityOf("long-one", { email: `${longLocal}@one.example.test` }))).username,
    "b".repeat(120));
  assert.equal((await db.profiles.upsert(identityOf("long-two", { email: `${longLocal}@two.example.test` }))).username,
    `${"b".repeat(118)}-2`, "a long base is trimmed so the suffixed name fits");
});

test("a new profile is refused when base to base-1000 are all taken", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const taken = ["cy", ...Array.from({ length: 998 }, (_, index) => `cy-${index + 2}`)];
  await db.knex.batchInsert("users", taken.map((username) => ({
    auth_provider: "local",
    auth_provider_user_sid: `identity-${username}`,
    email: `${username}@taken.example.test`,
    username,
    display_name: username
  })), 500);
  assert.equal((await db.profiles.upsert(identityOf("cy-last", { email: "cy@last.example.test" }))).username, "cy-1000");
  await assert.rejects(db.profiles.upsert(identityOf("cy-none", { email: "cy@none.example.test" })),
    /Unable to generate unique username\./u);
});

test("an email another identity holds is USER_PROFILE_EMAIL_CONFLICT, failing a caller's transaction", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  await db.profiles.upsert(identityOf("held"));
  await assert.rejects(db.profiles.upsert(identityOf("thief", { email: "held@example.test" })), (error) => {
    assert.equal(error.code, "USER_PROFILE_EMAIL_CONFLICT");
    assert.equal(error.transactionOutcome, "rolledBack");
    assert.ok(findDuplicateEntryError(error.cause));
    return true;
  });
  let participant = null;
  await assert.rejects(db.profiles.withTransaction({}, async (txOptions) => {
    try {
      await db.profiles.upsert(identityOf("thief", { email: "held@example.test" }), txOptions);
    } catch (error) {
      participant = error;
      throw error;
    }
  }), (error) => error.transactionOutcome === "rolledBack");
  assert.equal(participant.code, "USER_PROFILE_EMAIL_CONFLICT");
  assert.equal(participant.transactionOutcome, "pending");
  assert.equal(await db.profiles.findByIdentity({ provider: "local", providerUserId: "identity-thief" }), null);
});

test("a standalone profile insert that loses its identity to another answers the winner; in a caller's transaction it fails", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  let raceNext = true;
  let competitor = null;
  // Another request creates the same identity between this upsert's read and its insert.
  const racing = createUserProfilesRepository({
    userProfiles: {
      ...db.resources.userProfiles,
      async create(attributes, options) {
        if (raceNext) {
          raceNext = false;
          competitor = await insertProfile(db, "race", { email: "race.winner@example.test", username: "race-winner" });
        }
        return db.resources.userProfiles.create(attributes, options);
      }
    },
    userSettings: db.settings
  });
  const answered = await racing.upsert(identityOf("race"));
  assert.equal(answered.id, competitor);
  assert.equal(answered.email, "race.winner@example.test", "the winner's record, read after the insert rolled back");

  await db.knex("users").where({ id: competitor }).delete();
  raceNext = true;
  let participant = null;
  await assert.rejects(racing.withTransaction({}, async (txOptions) => {
    try {
      return await racing.upsert(identityOf("race"), txOptions);
    } catch (error) {
      participant = error;
      throw error;
    }
  }), (error) => error.transactionOutcome === "rolledBack");
  assert.equal(participant.transactionOutcome, "pending", "the caller's transaction is failed, not recovered");
  assert.ok(findDuplicateEntryError(participant));
});

test("user settings start from the defaults once, join a caller's transaction, and a lost standalone insert reads the winner", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const userId = await insertProfile(db, "settings");
  assert.equal(await db.settings.findByUserId(userId), null);
  const ensured = await db.settings.ensureForUserId(userId);
  assert.equal(ensured.id, userId);
  for (const [key, value] of Object.entries(DEFAULT_USER_SETTINGS)) assert.deepEqual(ensured[key], value, key);
  assert.deepEqual(await db.settings.ensureForUserId(userId), ensured, "a second call reads the same record");
  assert.equal((await db.settings.updatePreferences(userId, { theme: "dark", unknown: "dropped" })).theme, "dark");
  const passwordOff = await db.settings.updatePasswordSignInEnabled(userId, false, { passwordSetupRequired: true });
  assert.deepEqual([passwordOff.passwordSignInEnabled, passwordOff.passwordSetupRequired], [false, true]);
  await assert.rejects(db.settings.ensureForUserId("not-an-id"), /requires a valid user id/u);

  const rolledBack = await insertProfile(db, "settings-rolled");
  await assert.rejects(db.settings.withTransaction({}, async (txOptions) => {
    await db.settings.ensureForUserId(rolledBack, txOptions);
    throw new Error("Abort");
  }), /Abort/u);
  assert.equal(await db.settings.findByUserId(rolledBack), null, "it rolls back with the caller's transaction");

  const raced = await insertProfile(db, "settings-race");
  const racing = createUserSettingsRepository({
    userSettings: {
      ...db.resources.userSettings,
      async create(attributes, options) {
        await db.knex("user_settings").insert({ user_id: raced, theme: "light" });
        return db.resources.userSettings.create(attributes, options);
      }
    }
  });
  assert.equal((await racing.ensureForUserId(raced)).theme, "light", "the winner's settings");
  await db.knex("user_settings").where({ user_id: raced }).delete();
  await assert.rejects(racing.withTransaction({}, (txOptions) => racing.ensureForUserId(raced, txOptions)),
    (error) => error.transactionOutcome === "rolledBack" && Boolean(findDuplicateEntryError(error)));
});

test("countUsers counts every user, or those created since a time, leaving out the excluded", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const before = await db.profiles.countUsers();
  const one = await db.profiles.upsert(identityOf("count-one"));
  await db.profiles.upsert(identityOf("count-two"));
  assert.equal(await db.profiles.countUsers(), before + 2);
  assert.equal(await db.profiles.countUsers({ excludeIds: [one.id, one.id, "999999999"] }), before + 1);
  assert.equal(await db.profiles.countUsers({ createdSince: new Date(Date.now() + 86400000) }), 0);
});

test("users.profiles serves a CRUD feature's reads, with JSON:API documents passed through", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const created = await db.profiles.upsert(identityOf("crud"));
  const page = await db.profiles.query({ filters: { email: "crud@example.test" }, page: { size: 5 } }, {});
  assert.deepEqual(page.records.map(({ id }) => id), [created.id]);
  const document = await db.profiles.get(created.id, {}, { format: "jsonapi" });
  assert.equal(document.data.id, created.id);
  assert.equal(document.data.attributes.email, "crud@example.test");
  assert.equal(typeof db.profiles.pageLimits().request, "number");
});

test("countUsers counts only the users of one sign-in provider when asked", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const before = await db.profiles.countUsers({ authProvider: "oidc-count" });
  await db.profiles.upsert(identityOf("provider-a", { authProvider: "oidc-count" }));
  await db.profiles.upsert(identityOf("provider-b"));
  assert.equal(await db.profiles.countUsers({ authProvider: " OIDC-Count " }), before + 1);
});

test("createWithId creates a profile with the id it is given; a taken id fails", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  await insertProfile(db, "legacy-name");
  const created = await db.profiles.createWithId(identityOf("legacy", { id: "880001", username: "legacy-name" }));
  assert.equal(created.id, "880001");
  // The username is made unique, as a new profile's always is.
  assert.equal(created.username, "legacy-name-2");
  assert.match(created.createdAt, ISO);
  assert.equal((await db.profiles.findById("880001")).email, "legacy@example.test");
  await assert.rejects(db.profiles.createWithId(identityOf("legacy-again", { id: "880001" })),
    (error) => Boolean(findDuplicateEntryError(error)));
  await assert.rejects(db.profiles.createWithId(identityOf("no-id")), /createWithId requires id/u);
  await assert.rejects(db.profiles.createWithId({ id: "880002", email: "x@example.test" }),
    /createWithId requires authProvider, authProviderUserSid, displayName/u);
});

test("listByEmails answers the profiles of a set of emails in one read", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const one = await db.profiles.upsert(identityOf("emails-one"));
  const two = await db.profiles.upsert(identityOf("emails-two"));
  const { result, count } = await statementsOf(db, () => db.profiles.listByEmails([
    " Emails-One@Example.TEST ", "emails-two@example.test", "emails-one@example.test", "nobody@example.test"
  ]));
  assert.deepEqual(result.map(({ id }) => id).sort(), [one.id, two.id].sort());
  assert.equal(count, 1);
  assert.deepEqual(await db.profiles.listByEmails([]), []);
  await assert.rejects(db.profiles.listByEmails("one@example.test"), /takes an array of emails/u);
});

test("createManyIgnoringExisting creates the new identities, keeps the existing ones and runs only as background work", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const existing = await db.profiles.upsert(identityOf("bulk-existing"));
  const rows = [
    identityOf("bulk-existing", { email: "bulk-changed@example.test", displayName: "Changed", username: "bulk-changed" }),
    identityOf("bulk-new-one", { username: "bulk-new-one" }),
    identityOf("bulk-new-two", { username: "bulk-new-two" })
  ];
  await assert.rejects(db.profiles.createManyIgnoringExisting(rows, {}), /runs only in a system context/u);
  await assert.rejects(
    db.profiles.createManyIgnoringExisting([identityOf("bulk-no-username")], { context: db.systemContext }),
    /row 0 requires username/u
  );

  const ids = await db.profiles.createManyIgnoringExisting(rows, { context: db.systemContext });
  const created = await db.profiles.listByEmails(["bulk-new-one@example.test", "bulk-new-two@example.test"]);
  assert.deepEqual(created.map(({ id }) => id).sort(), [...ids].sort());
  assert.equal(ids.length, 2);
  // The existing identity's profile is untouched.
  assert.deepEqual(await db.profiles.findById(existing.id), existing);

  // Running it again creates nothing.
  assert.deepEqual(await db.profiles.createManyIgnoringExisting(rows, { context: db.systemContext }), []);
});

test("changeUsername gives a profile a free username and refuses one another profile holds", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const mine = await db.profiles.upsert(identityOf("rename-mine"));
  const other = await db.profiles.upsert(identityOf("rename-other"));
  const renamed = await db.profiles.changeUsername(mine.id, " Rename-Fresh ");
  assert.equal(renamed.username, "rename-fresh");
  assert.equal((await db.profiles.changeUsername(mine.id, "rename-fresh")).username, "rename-fresh");
  // Refused before any write, so the caller's transaction goes on.
  const kept = await db.profiles.withTransaction({}, async (txOptions) => {
    await assert.rejects(db.profiles.changeUsername(mine.id, other.username, txOptions), { code: "USER_PROFILE_USERNAME_CONFLICT" });
    return db.profiles.updateDisplayNameById(mine.id, "Still Mine", txOptions);
  });
  assert.equal(kept.displayName, "Still Mine");
  assert.equal(await db.profiles.changeUsername("999999999", "rename-ghost"), null);
});

test("a users list reads by display name, then email", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  for (const [tag, displayName] of [["sort-c", "Sort Bravo"], ["sort-a", "Sort Alpha"], ["sort-b", "Sort Bravo"]]) {
    await db.profiles.upsert(identityOf(tag, { displayName }));
  }
  const page = await db.profiles.query({ filters: { q: "sort-" }, page: { size: 10 } }, {});
  assert.deepEqual(page.records.map(({ email }) => email), ["sort-a@example.test", "sort-b@example.test", "sort-c@example.test"]);
});
