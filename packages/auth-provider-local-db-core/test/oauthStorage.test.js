import assert from "node:assert/strict";
import test from "node:test";
import createKnex from "knex";
import initialMigration from "../migrations/auth_local_db_initial.cjs";
import oauthMigration from "../migrations/auth_local_db_oauth.cjs";
import { createLocalDbBackend, LOCAL_AUTH_DB_TABLES } from "../src/server/lib/index.js";
import {
  ATTEMPT_COOKIE,
  approveAtProvider,
  createService,
  oidcProviderEntry,
  sessionCookies,
  startOidcProvider
} from "../../auth-provider-local-core/test-support/oauthHarness.js";

async function databaseBackend(t) {
  const knex = createKnex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.raw("PRAGMA foreign_keys = ON");
  await initialMigration.up(knex);
  await oauthMigration.up(knex);
  const backend = createLocalDbBackend({
    knex,
    transactionManager: { inTransaction: (work) => knex.transaction(work) }
  });
  return { knex, backend };
}

test("provider sign-in and linking store identities and single-use attempts in the database", async (t) => {
  const issuer = await startOidcProvider();
  t.after(() => issuer.close());
  const { knex, backend } = await databaseBackend(t);
  const service = createService({ backend, oauthProviders: [oidcProviderEntry(issuer)] });

  const { input, request } = await approveAtProvider(service);
  assert.equal((await knex(LOCAL_AUTH_DB_TABLES.oauthAttempts).count({ count: "*" }))[0].count, 1);
  const result = await service.oauthComplete(input, request);
  assert.equal((await knex(LOCAL_AUTH_DB_TABLES.oauthAttempts).count({ count: "*" }))[0].count, 0);
  await assert.rejects(service.oauthComplete(input, request), { code: "auth.local.oauth.expired" });

  const user = await knex(LOCAL_AUTH_DB_TABLES.users).where({ email: issuer.account.email }).first();
  assert.equal(user.password_hash, "", "a provider-created account has no password");
  assert.deepEqual(
    await knex(LOCAL_AUTH_DB_TABLES.identities).select("user_id", "provider", "provider_subject", "email"),
    [{ user_id: user.id, provider: "google", provider_subject: issuer.account.sub, email: issuer.account.email }]
  );

  const status = await service.getSecurityStatus({ cookies: sessionCookies(result.session) });
  assert.deepEqual(status.authMethods.map(({ id, enabled }) => [id, enabled]), [["password", false], ["oauth:google", true]]);
  await assert.rejects(service.unlinkProvider({ cookies: sessionCookies(result.session) }, { provider: "google" }), {
    code: "auth.local.oauth.lastMethod"
  });

  // Deleting the user removes its identities with it.
  await knex(LOCAL_AUTH_DB_TABLES.users).where({ id: user.id }).delete();
  assert.equal((await knex(LOCAL_AUTH_DB_TABLES.identities).count({ count: "*" }))[0].count, 0);
});

test("concurrent callbacks with one attempt complete at most once", async (t) => {
  const { backend } = await databaseBackend(t);
  const attempt = {
    browserKeyHash: "browser-key-hash",
    provider: "google",
    intent: "login",
    userId: "",
    state: "state",
    nonce: "nonce",
    codeVerifier: "verifier",
    returnTo: "/",
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
  await backend.withTransaction((tx) => tx.oauthAttempts.create(attempt));
  const taken = await Promise.all([1, 2, 3].map(() => backend.withTransaction((tx) => tx.oauthAttempts.take(attempt.browserKeyHash))));
  assert.equal(taken.filter(Boolean).length, 1);
  assert.equal(taken.find(Boolean).state, "state");
  assert.equal(taken.find(Boolean).userId, "");

  await backend.withTransaction(async (tx) => {
    await tx.oauthAttempts.create({ ...attempt, browserKeyHash: "old", expiresAt: new Date(Date.now() - 1000).toISOString() });
    await tx.oauthAttempts.create({ ...attempt, browserKeyHash: "fresh" });
    assert.equal(await tx.oauthAttempts.deleteExpired(new Date().toISOString()), 1);
    assert.equal(await tx.oauthAttempts.take("old"), null);
  });
});

test("an attempt cookie from another browser finds nothing", async (t) => {
  const issuer = await startOidcProvider();
  t.after(() => issuer.close());
  const { backend } = await databaseBackend(t);
  const service = createService({ backend, oauthProviders: [oidcProviderEntry(issuer)] });
  const { input } = await approveAtProvider(service);
  await assert.rejects(service.oauthComplete(input, { cookies: { [ATTEMPT_COOKIE]: "forged-browser-key" } }), {
    code: "auth.local.oauth.expired"
  });
});
