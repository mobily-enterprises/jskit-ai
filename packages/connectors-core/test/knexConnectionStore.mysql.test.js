import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import migration from "../migrations/connectors_core_initial.cjs";
import { createCredentialProtection, createKnexConnectionStore } from "../src/server/storage.js";

// The SQL connection store's behaviour on MariaDB, through withConnection and pruneExpiredAttempts, pinned before the
// store moves onto table resources. knexConnectionStore.test.js covers encryption, reopening through another pool,
// concurrent saves, rollback of a save, owner isolation of credentials and consent attempts when
// CONNECTORS_TEST_DATABASE_URL is set (it skips without it); this file adds what it leaves open: the values each call
// answers, which parts of a scope count, rollback of a disconnect and of a failed seal, attempt keys, the newest
// attempt, and pruning's count and boundary.

// The runtime's own MySQL connection settings (database-runtime's resolveKnexConnectionFromEnvironment).
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });

/** A migrated database of the test's own, beside TEST_DB_NAME, dropped after the test. */
async function ownDatabase(context, suffix) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw("CREATE DATABASE ??", [name]);
  const knex = knexLib({ client: "mysql2", connection: { ...server, database: name, ...RUNTIME_MYSQL }, pool: { min: 0, max: 4 } });
  context.after(async () => {
    await knex.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    await admin.destroy();
  });
  await migration.up(knex);
  return knex;
}

const protection = createCredentialProtection({ keys: { test: randomBytes(32) }, activeKeyId: "test" });
const owner = Object.freeze({ applicationId: "test-application", subjectId: "user-a" });
const scope = Object.freeze({ owner, integrationId: "calendar" });
const read = (store, at) => store.withConnection(at, async ({ connection }) => connection);

test("the store needs the application's Knex and credential protection, and answers what each call's work returns", async (context) => {
  requireTestDatabase(process.env);
  const knex = await ownDatabase(context, "da_conn_values");
  assert.throws(() => createKnexConnectionStore({ knex: {}, protection }), { name: "TypeError", message: "createKnexConnectionStore requires the application's Knex instance." });
  assert.throws(() => createKnexConnectionStore({ knex }), { name: "TypeError", message: "Connector storage requires credential protection." });
  assert.throws(() => createKnexConnectionStore({ knex, protection: { seal: async () => "" } }), { name: "TypeError", message: "Connector storage requires credential protection." });
  const store = createKnexConnectionStore({ knex, protection });
  assert.ok(Object.isFrozen(store));
  assert.deepEqual(Object.keys(store), ["withConnection", "pruneExpiredAttempts"]);

  const answered = await store.withConnection(scope, async (handle) => {
    assert.deepEqual(Object.keys(handle), ["connection", "save", "remove", "putAttempt", "latestAttempt", "consumeAttempt"]);
    assert.equal(handle.connection, null, "a new identity has no connection");
    assert.equal(await handle.save({ status: "connected", tokens: { accessToken: "a" }, at: new Date(Date.UTC(2026, 0, 1)) }), undefined);
    assert.equal(handle.connection, null, "the handle keeps the connection it opened with");
    assert.equal(await handle.putAttempt({ state: "state-1", expiresAt: Date.now() + 60_000 }), undefined);
    return { done: true };
  });
  assert.deepEqual(answered, { done: true });
  assert.deepEqual(await read(store, scope), { status: "connected", tokens: { accessToken: "a" }, at: "2026-01-01T00:00:00.000Z" }, "kept as JSON");
  assert.equal(await store.withConnection(scope, async ({ remove }) => remove()), undefined);
  assert.equal(await read(store, scope), null, "a disconnect leaves no connection");
  assert.equal(await store.withConnection(scope, ({ consumeAttempt }) => consumeAttempt("state-1")), null, "and no attempts");
  await store.withConnection(scope, ({ save }) => save({ status: "reconnected" }));
  assert.deepEqual(await read(store, scope), { status: "reconnected" }, "an identity connects again after a disconnect");
});

test("a connection is the owner's application, subject and integration, and nothing else in the scope", async (context) => {
  requireTestDatabase(process.env);
  const store = createKnexConnectionStore({ knex: await ownDatabase(context, "da_conn_scope"), protection });
  await store.withConnection(scope, ({ save }) => save({ account: "calendar-a" }));
  await store.withConnection({ owner, integrationId: "mail" }, ({ save }) => save({ account: "mail-a" }));

  assert.deepEqual(await read(store, scope), { account: "calendar-a" });
  assert.deepEqual(await read(store, { owner, integrationId: "mail" }), { account: "mail-a" }, "each integration of an owner is its own");
  assert.equal(await read(store, { owner: { ...owner, subjectId: "user-b" }, integrationId: "calendar" }), null);
  assert.equal(await read(store, { owner: { ...owner, applicationId: "other-application" }, integrationId: "calendar" }), null);
  // Fields of the owner other than applicationId and subjectId do not separate connections.
  assert.deepEqual(await read(store, { owner: { ...owner, workspaceId: "workspace-9", role: "admin" }, integrationId: "calendar" }), { account: "calendar-a" });
  assert.deepEqual(await read(store, { owner: { subjectId: owner.subjectId, applicationId: owner.applicationId }, integrationId: "calendar" }), { account: "calendar-a" });
});

test("a failed disconnect or a failed seal keeps the connection and its attempts as they were", async (context) => {
  requireTestDatabase(process.env);
  const knex = await ownDatabase(context, "da_conn_rollback");
  const store = createKnexConnectionStore({ knex, protection });
  const attempt = { state: "pending-state", codeVerifier: "verifier", expiresAt: Date.now() + 60_000 };
  await store.withConnection(scope, async ({ save, putAttempt }) => {
    await save({ version: 1 });
    await putAttempt(attempt);
  });

  const failure = new Error("revocation failed");
  await assert.rejects(store.withConnection(scope, async ({ remove }) => {
    await remove();
    throw failure;
  }), (error) => error === failure);
  assert.deepEqual(await read(store, scope), { version: 1 });
  assert.deepEqual(await store.withConnection(scope, ({ latestAttempt }) => latestAttempt({ after: Date.now() })), attempt);

  const sealFailure = new Error("vault unavailable");
  const brokenWriter = createKnexConnectionStore({ knex, protection: { ...protection, seal: async () => { throw sealFailure; } } });
  await assert.rejects(brokenWriter.withConnection(scope, async ({ save }) => {
    await save({ version: 2 });
  }), (error) => error === sealFailure);
  assert.deepEqual(await read(store, scope), { version: 1 });
  assert.deepEqual(await store.withConnection(scope, ({ consumeAttempt }) => consumeAttempt(attempt.state)), attempt);
});

test("an attempt is keyed by its state alone, the newest live one is answered, and consuming takes it once", async (context) => {
  requireTestDatabase(process.env);
  const store = createKnexConnectionStore({ knex: await ownDatabase(context, "da_conn_attempts"), protection });
  const now = Date.now();
  const older = { state: "older", expiresAt: now + 10_000, owner, integrationId: "calendar" };
  const newer = { state: "newer", expiresAt: now + 20_000, owner, integrationId: "calendar" };
  await store.withConnection(scope, async ({ putAttempt, latestAttempt }) => {
    assert.equal(await latestAttempt({ after: now }), null);
    await putAttempt(newer);
    await putAttempt(older);
    assert.deepEqual(await latestAttempt({ after: now }), newer, "the attempt that expires last, whatever the order it was put in");
    assert.deepEqual(await latestAttempt({ after: older.expiresAt }), newer);
    assert.equal(await latestAttempt({ after: newer.expiresAt }), null, "an attempt expiring exactly at `after` is not live");
  });

  // The same state twice fails with the driver's own duplicate-key error, for the same connection and, because an
  // attempt's key is its state's hash alone, for another owner's connection too.
  for (const at of [scope, { owner: { ...owner, subjectId: "user-b" }, integrationId: "calendar" }]) {
    await assert.rejects(store.withConnection(at, ({ putAttempt }) => putAttempt({ state: "newer", expiresAt: now + 30_000 })), (error) => {
      assert.equal(error.code, "ER_DUP_ENTRY");
      return true;
    });
  }

  assert.deepEqual(await store.withConnection(scope, ({ consumeAttempt }) => consumeAttempt("older")), older);
  assert.equal(await store.withConnection(scope, ({ consumeAttempt }) => consumeAttempt("older")), null, "taken once");
  assert.deepEqual(await store.withConnection(scope, ({ latestAttempt }) => latestAttempt({ after: now })), newer, "the other attempt stays");
  // A consumed state can be put again.
  await store.withConnection(scope, ({ putAttempt }) => putAttempt({ state: "older", expiresAt: now + 5_000 }));
  assert.equal((await store.withConnection(scope, ({ consumeAttempt }) => consumeAttempt("older"))).expiresAt, now + 5_000);
});

test("pruning removes every connection's attempts that expired by `before`, inclusive, and answers how many", async (context) => {
  requireTestDatabase(process.env);
  const store = createKnexConnectionStore({ knex: await ownDatabase(context, "da_conn_prune"), protection });
  const before = Date.now() + 60_000;
  const otherScope = { owner: { ...owner, subjectId: "user-b" }, integrationId: "mail" };
  assert.equal(await store.pruneExpiredAttempts({ before }), 0, "nothing to prune");
  await store.withConnection(scope, async ({ putAttempt }) => {
    await putAttempt({ state: "a-expired", expiresAt: before - 1 });
    await putAttempt({ state: "a-boundary", expiresAt: before });
    await putAttempt({ state: "a-live", expiresAt: before + 1 });
  });
  await store.withConnection(otherScope, ({ putAttempt }) => putAttempt({ state: "b-expired", expiresAt: before - 5_000 }));

  assert.equal(await store.pruneExpiredAttempts({ before }), 3);
  assert.equal(await store.pruneExpiredAttempts({ before }), 0, "pruning again finds nothing");
  for (const state of ["a-expired", "a-boundary"]) {
    assert.equal(await store.withConnection(scope, ({ consumeAttempt }) => consumeAttempt(state)), null, state);
  }
  assert.equal(await store.withConnection(otherScope, ({ consumeAttempt }) => consumeAttempt("b-expired")), null);
  assert.equal((await store.withConnection(scope, ({ consumeAttempt }) => consumeAttempt("a-live"))).state, "a-live");

  // Without `before`, now is the boundary.
  await store.withConnection(scope, async ({ putAttempt }) => {
    await putAttempt({ state: "past", expiresAt: Date.now() - 1_000 });
    await putAttempt({ state: "future", expiresAt: Date.now() + 60_000 });
  });
  assert.equal(await store.pruneExpiredAttempts(), 1);
  assert.equal((await store.withConnection(scope, ({ latestAttempt }) => latestAttempt({ after: 0 }))).state, "future");
});
