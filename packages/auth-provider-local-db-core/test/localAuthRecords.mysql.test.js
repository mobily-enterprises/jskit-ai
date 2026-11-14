import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { checkForeignKeys } from "@jskit-ai/resource-runtime/server";
import { expectEveryTableOwned } from "@jskit-ai/resource-runtime/test";
import { LOCAL_AUTH_RESOURCES } from "../src/server/lib/localAuthResources.js";
import { LOCAL_AUTH_INFRASTRUCTURE_TABLES } from "../src/server/lib/index.js";
import { openLocalAuthDatabase } from "./support/mysqlLocalAuth.js";

// Local sign-in's records on MariaDB, through the auth.local.backend transaction and the owner APIs
// (auth.local.accounts, auth.local.sessions, auth.local.recovery), pinned before they move onto table resources:
// what each call answers and keeps, its nulls and counts, its refusals, and joining and rolling back with a caller's
// transaction.

const PASSWORD = Object.freeze({ algorithm: "scrypt", version: "1", salt: "salt-one", hash: "hash-one" });
const NEXT_PASSWORD = Object.freeze({ algorithm: "scrypt", version: "2", salt: "salt-two", hash: "hash-two" });
const NO_PASSWORD = Object.freeze({ algorithm: "", version: "", salt: "", hash: "" });
const CREATED = "2026-11-01T08:00:00.000Z";
const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u;
const ACCOUNT_KEYS = ["id", "email", "displayName", "password", "createdAt", "updatedAt", "emailVerifiedAt", "disabled", "disabledMessage"];
const SESSION_KEYS = ["id", "userId", "tokenHash", "purpose", "createdAt", "expiresAt", "revokedAt", "secondFactorAt", "ip", "userAgent", "lastSeenAt"];
const RECOVERY_KEYS = ["id", "userId", "tokenHash", "createdAt", "expiresAt", "usedAt"];

/** The current second, as the second-precision timestamps keep it. */
const thisSecond = () => Math.floor(Date.now() / 1000) * 1000;

/** Asserts a stored timestamp lies between a second taken before the call and now. */
function assertStoredSince(value, before, label) {
  assert.match(value, ISO_SECONDS, label);
  assert.ok(Date.parse(value) >= before && Date.parse(value) <= Date.now() + 1000, `${label}: ${value}`);
}

const account = (id, email, extra = {}) => ({ id, email, displayName: `Name ${id}`, password: PASSWORD, createdAt: CREATED, ...extra });

test("accounts: create answers the account it wrote, reads find it by id and email, and an email or id is taken once", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_accounts");
  assert.deepEqual(Object.keys(backend), ["tables", "withTransaction"]);
  assert.deepEqual(backend.tables, {
    users: "auth_local_users",
    sessions: "auth_local_sessions",
    recovery: "auth_local_recovery",
    identities: "auth_local_identities",
    oauthAttempts: "auth_local_oauth_attempts",
    signInFailures: "auth_local_sign_in_failures",
    registrations: "auth_local_registrations",
    secondFactors: "auth_local_second_factors",
    passes: "auth_local_used_passes"
  });
  assert.equal(await backend.withTransaction((tx) => tx.users.hasAny()), false);

  const created = await backend.withTransaction((tx) => tx.users.create(account("usr_ada", "ada@example.com", {
    createdAt: "2026-11-01T08:00:00.123Z"
  })));
  assert.deepEqual(created, {
    id: "usr_ada",
    email: "ada@example.com",
    displayName: "Name usr_ada",
    password: PASSWORD,
    createdAt: "2026-11-01T08:00:00.123Z",
    updatedAt: "2026-11-01T08:00:00.123Z",
    emailVerifiedAt: "",
    disabled: false,
    disabledMessage: ""
  }, "create answers what it wrote, to the millisecond, and updatedAt defaults to createdAt");

  const before = thisSecond();
  const plain = await backend.withTransaction((tx) => tx.users.create({ id: "usr_bob", email: "bob@example.com", displayName: "", password: NO_PASSWORD, disabled: true }));
  assert.deepEqual(Object.keys(plain), ACCOUNT_KEYS);
  assert.equal(plain.displayName, "");
  assert.deepEqual(plain.password, NO_PASSWORD);
  assert.equal(plain.disabled, true);
  assert.ok(Date.parse(plain.createdAt) >= before - 1000 && plain.createdAt === plain.updatedAt, "createdAt defaults to now");

  await backend.withTransaction(async (tx) => {
    assert.equal(await tx.users.hasAny(), true);
    const read = await tx.users.findById("usr_ada");
    assert.deepEqual(Object.keys(read), ACCOUNT_KEYS);
    assert.deepEqual(read, { ...created, createdAt: CREATED, updatedAt: CREATED }, "the table keeps whole seconds");
    assert.deepEqual(await tx.users.findByEmail("ada@example.com"), read);
    assert.deepEqual(await tx.users.findByEmail("ADA@Example.com"), read, "the email column compares without case");
    const disabled = await tx.users.findById("usr_bob");
    assert.equal(disabled.disabled, true);
    assert.deepEqual(disabled.password, NO_PASSWORD, "an account without a password keeps empty password fields");
    assert.equal(disabled.displayName, "");
    assert.equal(await tx.users.findById("usr_missing"), null);
    assert.equal(await tx.users.findById(""), null);
    assert.equal(await tx.users.findById(null), null);
    assert.equal(await tx.users.findByEmail("nobody@example.com"), null);
    assert.equal(await tx.users.findByEmail(""), null);
  });

  const taken = (error) => {
    assert.equal(error.code, "auth.local.accounts.exists");
    assert.equal(error.status, 409);
    return true;
  };
  await assert.rejects(backend.withTransaction((tx) => tx.users.create(account("usr_other", "ada@example.com"))), taken);
  await assert.rejects(backend.withTransaction((tx) => tx.users.create(account("usr_ada", "new@example.com"))), taken);
  await assert.rejects(backend.withTransaction(async (tx) => {
    await tx.users.create(account("usr_carol", "carol@example.com"));
    await tx.users.create(account("usr_dave", "carol@example.com"));
  }), taken);
  assert.equal(await backend.withTransaction((tx) => tx.users.findById("usr_carol")), null, "the failed transaction rolled back whole");
});

test("accounts: password, profile and email-proof updates answer the account after the change, or null for an unknown one", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_updates");
  const created = await backend.withTransaction((tx) => tx.users.create(account("usr_ada", "ada@example.com")));

  let before = thisSecond();
  const repassworded = await backend.withTransaction((tx) => tx.users.updatePassword("usr_ada", NEXT_PASSWORD));
  assert.deepEqual(Object.keys(repassworded), ACCOUNT_KEYS);
  assert.deepEqual({ ...repassworded, updatedAt: "" }, { ...created, password: NEXT_PASSWORD, updatedAt: "" });
  assertStoredSince(repassworded.updatedAt, before, "updatePassword touches updatedAt");
  assert.deepEqual((await backend.withTransaction((tx) => tx.users.updatePassword("usr_ada", { hash: "only" }))).password,
    { algorithm: "", version: "", salt: "", hash: "only" }, "missing password fields are written empty");
  assert.equal(await backend.withTransaction((tx) => tx.users.updatePassword("usr_missing", NEXT_PASSWORD)), null);

  before = thisSecond();
  const renamed = await backend.withTransaction((tx) => tx.users.updateProfile("usr_ada", { displayName: "Ada L." }));
  assert.equal(renamed.displayName, "Ada L.");
  assertStoredSince(renamed.updatedAt, before, "updateProfile touches updatedAt");
  const untouched = await backend.withTransaction((tx) => tx.users.updateProfile("usr_ada", { displayName: 7, email: "x@example.com" }));
  assert.equal(untouched.displayName, "Ada L.", "only a text displayName is written");
  assert.equal(untouched.email, "ada@example.com");
  assert.equal((await backend.withTransaction((tx) => tx.users.updateProfile("usr_ada"))).displayName, "Ada L.");
  assert.equal((await backend.withTransaction((tx) => tx.users.updateProfile("usr_ada", { displayName: "" }))).displayName, "");
  assert.equal(await backend.withTransaction((tx) => tx.users.updateProfile("usr_missing", { displayName: "X" })), null);

  before = thisSecond();
  const verified = await backend.withTransaction((tx) => tx.users.markEmailVerified("usr_ada"));
  assertStoredSince(verified.emailVerifiedAt, before, "markEmailVerified stamps the proof");
  const updatedAt = verified.updatedAt;
  const again = await backend.withTransaction((tx) => tx.users.markEmailVerified("usr_ada"));
  assert.equal(again.emailVerifiedAt, verified.emailVerifiedAt, "the first proof is kept");
  assert.equal(again.updatedAt, updatedAt, "the proof leaves updatedAt alone");
  assert.equal(await backend.withTransaction((tx) => tx.users.markEmailVerified("usr_missing")), null);
});

test("sessions: create, reads, revoke once, revoke a user's live sessions but one, and delete the expired", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_sessions");
  await backend.withTransaction((tx) => tx.users.create(account("usr_ada", "ada@example.com")));
  await backend.withTransaction((tx) => tx.users.create(account("usr_bob", "bob@example.com")));

  const session = (id, userId, expiresAt, extra = {}) => ({ id, userId, tokenHash: `hash-${id}`, expiresAt, createdAt: CREATED, ...extra });
  const created = await backend.withTransaction((tx) => tx.sessions.create(session("ses_one", "usr_ada", "2026-12-01T00:00:00.000Z")));
  assert.deepEqual(created, {
    id: "ses_one",
    userId: "usr_ada",
    tokenHash: "hash-ses_one",
    purpose: "normal",
    createdAt: CREATED,
    expiresAt: "2026-12-01T00:00:00.000Z",
    revokedAt: "",
    secondFactorAt: "",
    ip: "",
    userAgent: "",
    lastSeenAt: ""
  }, "a session without a purpose is a normal one");
  const preview = await backend.withTransaction((tx) => tx.sessions.create(session("ses_two", "usr_ada", "2026-12-01T00:00:00.000Z", { purpose: "dev-auth" })));
  assert.equal(preview.purpose, "dev-auth");
  await backend.withTransaction(async (tx) => {
    await tx.sessions.create(session("ses_three", "usr_ada", "2026-11-08T00:00:00.000Z"));
    await tx.sessions.create(session("ses_bob", "usr_bob", "2026-11-01T00:00:00.000Z"));
  });

  await backend.withTransaction(async (tx) => {
    const read = await tx.sessions.findById("ses_one");
    assert.deepEqual(Object.keys(read), SESSION_KEYS);
    assert.deepEqual(read, created);
    assert.deepEqual(await tx.sessions.findByTokenHash("hash-ses_one"), created);
    assert.equal(await tx.sessions.findById("ses_missing"), null);
    assert.equal(await tx.sessions.findByTokenHash("hash-missing"), null);
    assert.equal(await tx.sessions.findByTokenHash(""), null);
  });
  await assert.rejects(backend.withTransaction((tx) => tx.sessions.create(session("ses_dup", "usr_ada", "2026-12-01T00:00:00.000Z", { tokenHash: "hash-ses_one" }))));

  const before = thisSecond();
  const revoked = await backend.withTransaction((tx) => tx.sessions.revoke("ses_one"));
  assert.deepEqual({ ...revoked, revokedAt: "" }, created);
  assertStoredSince(revoked.revokedAt, before, "revoke stamps revokedAt");
  assert.deepEqual(await backend.withTransaction((tx) => tx.sessions.revoke("ses_one")), revoked, "a revoked session stays as it was");
  assert.equal(await backend.withTransaction((tx) => tx.sessions.revoke("ses_missing")), null);

  assert.equal(await backend.withTransaction((tx) => tx.sessions.revokeForUser("usr_ada", { exceptSessionId: "ses_two" })), 1,
    "only ses_three: ses_one was revoked already and ses_two is kept");
  assert.equal((await backend.withTransaction((tx) => tx.sessions.findById("ses_two"))).revokedAt, "");
  assert.equal(await backend.withTransaction((tx) => tx.sessions.revokeForUser("usr_ada")), 1);
  assert.equal(await backend.withTransaction((tx) => tx.sessions.revokeForUser("usr_ada")), 0);
  assert.equal(await backend.withTransaction((tx) => tx.sessions.revokeForUser("usr_missing")), 0);
  assert.equal((await backend.withTransaction((tx) => tx.sessions.findById("ses_bob"))).revokedAt, "", "another user's session is untouched");

  assert.equal(await backend.withTransaction((tx) => tx.sessions.deleteExpired("2026-11-08T00:00:00.000Z")), 2,
    "ses_three expires exactly then and ses_bob before");
  assert.equal(await backend.withTransaction((tx) => tx.sessions.findById("ses_three")), null);
  assert.equal(await backend.withTransaction((tx) => tx.sessions.deleteExpired(new Date("2026-11-08T00:00:00.000Z"))), 0);
  assert.ok(await backend.withTransaction((tx) => tx.sessions.findById("ses_one")));
});

test("recovery: create, find by token hash, consume once, and consume a user's open tokens", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_recovery");
  await backend.withTransaction((tx) => tx.users.create(account("usr_ada", "ada@example.com")));
  const token = (id, extra = {}) => ({ id, userId: "usr_ada", tokenHash: `hash-${id}`, expiresAt: "2026-12-01T00:00:00.000Z", createdAt: CREATED, ...extra });

  const created = await backend.withTransaction((tx) => tx.recovery.create(token("rec_one")));
  assert.deepEqual(created, {
    id: "rec_one",
    userId: "usr_ada",
    tokenHash: "hash-rec_one",
    createdAt: CREATED,
    expiresAt: "2026-12-01T00:00:00.000Z",
    usedAt: ""
  });
  const read = await backend.withTransaction((tx) => tx.recovery.findByTokenHash("hash-rec_one"));
  assert.deepEqual(Object.keys(read), RECOVERY_KEYS);
  assert.deepEqual(read, created);
  assert.equal(await backend.withTransaction((tx) => tx.recovery.findByTokenHash("hash-missing")), null);
  assert.equal(await backend.withTransaction((tx) => tx.recovery.findByTokenHash("")), null);

  const before = thisSecond();
  const used = await backend.withTransaction((tx) => tx.recovery.consume("rec_one"));
  assert.deepEqual({ ...used, usedAt: "" }, created);
  assertStoredSince(used.usedAt, before, "consume stamps usedAt");
  assert.equal(await backend.withTransaction((tx) => tx.recovery.consume("rec_one")), null, "a used token is not consumed again");
  assert.deepEqual(await backend.withTransaction((tx) => tx.recovery.findByTokenHash("hash-rec_one")), used, "and stays as it was");
  assert.equal(await backend.withTransaction((tx) => tx.recovery.consume("rec_missing")), null);
  await backend.withTransaction((tx) => tx.recovery.create(token("rec_race")));
  const racers = await Promise.all([1, 2].map(() => backend.withTransaction((tx) => tx.recovery.consume("rec_race"))));
  assert.equal(racers.filter(Boolean).length, 1, "of two consumers at once, exactly one consumes the token");

  await backend.withTransaction(async (tx) => {
    await tx.recovery.create(token("rec_two"));
    await tx.recovery.create(token("rec_three", { usedAt: "2026-11-02T00:00:00.000Z" }));
  });
  assert.equal((await backend.withTransaction((tx) => tx.recovery.findByTokenHash("hash-rec_three"))).usedAt, "2026-11-02T00:00:00.000Z");
  assert.equal(await backend.withTransaction((tx) => tx.recovery.consumeForUser("usr_ada", { idPrefix: "rec_" })), 1, "only rec_two was open");
  assert.equal(await backend.withTransaction((tx) => tx.recovery.consumeForUser("usr_ada", { idPrefix: "rec_" })), 0);
  assert.equal((await backend.withTransaction((tx) => tx.recovery.findByTokenHash("hash-rec_three"))).usedAt, "2026-11-02T00:00:00.000Z");
});

test("identities and provider sign-in attempts: links by provider subject, and an attempt taken once", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_identities");
  await backend.withTransaction((tx) => tx.users.create(account("usr_ada", "ada@example.com")));
  const link = (provider, providerSubject) => ({ userId: "usr_ada", provider, providerSubject, email: "ada@example.com", createdAt: CREATED });

  assert.deepEqual(await backend.withTransaction((tx) => tx.identities.create(link("google", "sub-1"))), {
    userId: "usr_ada", provider: "google", providerSubject: "sub-1", email: "ada@example.com", createdAt: CREATED
  });
  await backend.withTransaction((tx) => tx.identities.create(link("github", "sub-1")));
  await assert.rejects(backend.withTransaction((tx) => tx.identities.create(link("google", "sub-1"))));
  await backend.withTransaction(async (tx) => {
    assert.equal((await tx.identities.findByProviderSubject("github", "sub-1")).provider, "github");
    assert.equal(await tx.identities.findByProviderSubject("microsoft", "sub-1"), null);
    assert.deepEqual((await tx.identities.listForUser("usr_ada")).map(({ provider }) => provider), ["github", "google"]);
    assert.deepEqual(await tx.identities.listForUser("usr_missing"), []);
    assert.equal(await tx.identities.deleteForUser("usr_ada", "github"), 1);
    assert.equal(await tx.identities.deleteForUser("usr_ada", "github"), 0);
  });

  const attempt = (browserKeyHash, expiresAt, extra = {}) => ({
    browserKeyHash, provider: "google", intent: "login", state: `state-${browserKeyHash}`, nonce: "nonce", codeVerifier: "verifier",
    returnTo: "/home", expiresAt, createdAt: CREATED, ...extra
  });
  const created = await backend.withTransaction((tx) => tx.oauthAttempts.create(attempt("key-one", "2026-12-01T00:00:00.000Z")));
  assert.deepEqual(created, {
    browserKeyHash: "key-one", provider: "google", intent: "login", userId: "", state: "state-key-one", nonce: "nonce",
    codeVerifier: "verifier", returnTo: "/home", createdAt: CREATED, expiresAt: "2026-12-01T00:00:00.000Z"
  }, "an attempt without a user keeps none");
  await backend.withTransaction((tx) => tx.oauthAttempts.create(attempt("key-link", "2026-12-01T00:00:00.000Z", { intent: "link", userId: "usr_ada" })));

  const taken = await Promise.all([1, 2, 3].map(() => backend.withTransaction((tx) => tx.oauthAttempts.take("key-one"))));
  assert.deepEqual(taken.filter(Boolean), [created], "concurrent takes of one attempt answer it once");
  assert.equal(await backend.withTransaction((tx) => tx.oauthAttempts.take("key-one")), null);
  assert.equal(await backend.withTransaction((tx) => tx.oauthAttempts.take("")), null);
  assert.equal((await backend.withTransaction((tx) => tx.oauthAttempts.take("key-link"))).userId, "usr_ada");

  await backend.withTransaction(async (tx) => {
    await tx.oauthAttempts.create(attempt("key-old", "2026-11-01T00:00:00.000Z"));
    await tx.oauthAttempts.create(attempt("key-edge", "2026-11-08T00:00:00.000Z"));
    await tx.oauthAttempts.create(attempt("key-live", "2026-11-09T00:00:00.000Z"));
    assert.equal(await tx.oauthAttempts.deleteExpired("2026-11-08T00:00:00.000Z"), 2);
  });
  assert.equal(await backend.withTransaction((tx) => tx.oauthAttempts.take("key-edge")), null);
  assert.equal((await backend.withTransaction((tx) => tx.oauthAttempts.take("key-live"))).browserKeyHash, "key-live");
});

test("sign-in failures: save replaces the email's record, clear and deleteBefore count what they delete", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_failures");
  await backend.withTransaction(async (tx) => {
    assert.equal(await tx.signInFailures.find("ada@example.com"), null);
    assert.deepEqual(await tx.signInFailures.save({ email: "ada@example.com", failures: 1, lastFailedAt: "2026-11-08T09:00:00.000Z" }), {
      email: "ada@example.com", failures: 1, lastFailedAt: "2026-11-08T09:00:00.000Z", lockedUntil: ""
    });
    assert.deepEqual(await tx.signInFailures.save({ email: "ada@example.com", failures: 3, lastFailedAt: "2026-11-08T09:05:00.000Z", lockedUntil: "2026-11-08T09:10:00.000Z" }), {
      email: "ada@example.com", failures: 3, lastFailedAt: "2026-11-08T09:05:00.000Z", lockedUntil: "2026-11-08T09:10:00.000Z"
    });
    await tx.signInFailures.save({ email: "bob@example.com", failures: "2", lastFailedAt: "2026-11-07T09:00:00.000Z" });
  });
  await backend.withTransaction(async (tx) => {
    assert.deepEqual(await tx.signInFailures.find("ada@example.com"), {
      email: "ada@example.com", failures: 3, lastFailedAt: "2026-11-08T09:05:00.000Z", lockedUntil: "2026-11-08T09:10:00.000Z"
    });
    assert.equal((await tx.signInFailures.find("bob@example.com")).failures, 2);
    assert.equal(await tx.signInFailures.deleteBefore("2026-11-07T09:00:00.000Z"), 0, "deleteBefore keeps a failure exactly then");
    assert.equal(await tx.signInFailures.deleteBefore("2026-11-08T00:00:00.000Z"), 1);
    assert.equal(await tx.signInFailures.find("bob@example.com"), null);
    assert.equal(await tx.signInFailures.clear("ada@example.com"), 1);
    assert.equal(await tx.signInFailures.clear("ada@example.com"), 0);
    assert.equal(await tx.signInFailures.find("ada@example.com"), null);
  });
});

test("registrations: save replaces the email's waiting registration, found by email or token hash until deleted or expired", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_registrations");
  const registration = (email, tokenHash, expiresAt, extra = {}) => ({
    email, displayName: "Ada", password: PASSWORD, tokenHash, createdAt: CREATED, expiresAt, ...extra
  });
  const saved = await backend.withTransaction((tx) => tx.registrations.save(registration("ada@example.com", "token-one", "2026-11-09T00:00:00.000Z")));
  assert.deepEqual(saved, {
    email: "ada@example.com", displayName: "Ada", password: PASSWORD, invitation: null, tokenHash: "token-one",
    createdAt: CREATED, expiresAt: "2026-11-09T00:00:00.000Z"
  });
  await backend.withTransaction(async (tx) => {
    assert.deepEqual(await tx.registrations.findByEmail("ada@example.com"), saved);
    assert.deepEqual(await tx.registrations.findByTokenHash("token-one"), saved);
    assert.equal(await tx.registrations.findByEmail("bob@example.com"), null);
    assert.equal(await tx.registrations.findByTokenHash("token-missing"), null);
  });

  const invited = registration("ada@example.com", "token-two", "2026-11-10T00:00:00.000Z", {
    displayName: "Ada L.", invitation: { token: "invite-token", source: "workspace" }
  });
  assert.deepEqual((await backend.withTransaction((tx) => tx.registrations.save(invited))).invitation, { token: "invite-token", source: "workspace" });
  await backend.withTransaction(async (tx) => {
    assert.equal(await tx.registrations.findByTokenHash("token-one"), null, "the renewed registration replaced the first link");
    const replaced = await tx.registrations.findByEmail("ada@example.com");
    assert.equal(replaced.displayName, "Ada L.");
    assert.equal(replaced.tokenHash, "token-two");
    assert.equal(replaced.expiresAt, "2026-11-10T00:00:00.000Z");
    assert.deepEqual(replaced.invitation, { token: "invite-token", source: "workspace" });
    await tx.registrations.save(registration("bob@example.com", "token-bob", "2026-11-08T00:00:00.000Z", { invitation: { token: "", source: "x" } }));
    assert.equal((await tx.registrations.findByEmail("bob@example.com")).invitation, null, "an invitation without a token is none");
    await tx.registrations.save(registration("carol@example.com", "token-carol", "2026-11-07T00:00:00.000Z"));
    assert.equal(await tx.registrations.deleteExpired("2026-11-08T00:00:00.000Z"), 2);
    assert.equal(await tx.registrations.findByEmail("bob@example.com"), null);
    assert.equal(await tx.registrations.delete("ada@example.com"), 1);
    assert.equal(await tx.registrations.delete("ada@example.com"), 0);
    assert.equal(await tx.registrations.findByEmail("ada@example.com"), null);
  });
});

test("two first saves of one email's sign-in failure at once both succeed: the loser runs once more and updates the row", async (context) => {
  requireTestDatabase(process.env);
  const { backend, knex } = await openLocalAuthDatabase(context, "da_local_first_save");
  const bothRead = Promise.withResolvers();
  let reads = 0;
  let runs = 0;
  // Each reads before either writes, so both create the row and one of them fails with a duplicate entry.
  const save = (failures) => backend.withTransaction(async (tx) => {
    runs += 1;
    assert.equal(runs > 2 || await tx.signInFailures.find("race@example.com") === null, true);
    reads += 1;
    if (reads === 2) bothRead.resolve();
    await bothRead.promise;
    return tx.signInFailures.save({ email: "race@example.com", failures, lastFailedAt: CREATED });
  });
  const saved = await Promise.all([save(1), save(2)]);
  assert.equal(runs, 3, "only the loser ran again, once");
  const [row] = await knex("auth_local_sign_in_failures").where({ email: "race@example.com" });
  assert.ok(saved.some(({ failures }) => failures === Number(row.failures)), "the row holds the last save");
  assert.equal(Number((await knex("auth_local_sign_in_failures").count({ count: "*" }).first()).count), 1);
});

test("two first registrations of one email at once both succeed, and the row holds one of them", async (context) => {
  requireTestDatabase(process.env);
  const { backend, knex } = await openLocalAuthDatabase(context, "da_local_first_registration");
  const bothRead = Promise.withResolvers();
  let reads = 0;
  // Each finds no registration before either writes; one upsert, keyed on the email, creates or replaces the row. A
  // deadlock victim runs again whole, and then finds the other's registration.
  const register = (tokenHash) => backend.withTransaction(async (tx) => {
    assert.equal(reads >= 2 || await tx.registrations.findByEmail("race@example.com") === null, true);
    reads += 1;
    if (reads === 2) bothRead.resolve();
    await bothRead.promise;
    return tx.registrations.save({
      email: "race@example.com", displayName: "Ada", password: PASSWORD, tokenHash, createdAt: CREATED, expiresAt: "2026-11-09T00:00:00.000Z"
    });
  });
  const saved = await Promise.all([register("token-one"), register("token-two")]);
  const rows = await knex("auth_local_registrations").where({ email: "race@example.com" });
  assert.equal(rows.length, 1);
  assert.ok(saved.some(({ tokenHash }) => tokenHash === rows[0].token_hash), "the row holds one of the two registrations");
});

test("concurrent failed sign-ins for one email each count: find holds the email's record until the transaction ends", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_throttle");
  await backend.withTransaction((tx) => tx.signInFailures.save({ email: "guess@example.com", failures: 1, lastFailedAt: CREATED }));
  // Each failure reads the count, waits as a password check does, then saves one more.
  const fail = () => backend.withTransaction(async (tx) => {
    const failures = await tx.signInFailures.find("guess@example.com");
    await new Promise((resolve) => setTimeout(resolve, 20));
    return tx.signInFailures.save({ email: "guess@example.com", failures: failures.failures + 1, lastFailedAt: CREATED });
  });
  await Promise.all([fail(), fail(), fail(), fail(), fail()]);
  assert.equal((await backend.withTransaction((tx) => tx.signInFailures.find("guess@example.com"))).failures, 6);
});

test("the owner APIs answer as the backend does and join a caller's transaction, whose rollback undoes their writes", async (context) => {
  requireTestDatabase(process.env);
  const { accounts, sessions, recovery, backend, inCallerTransaction } = await openLocalAuthDatabase(context, "da_local_owners");
  assert.deepEqual(Object.keys(accounts), ["create", "findById", "findByEmail", "updatePassword", "updateProfile", "markEmailVerified", "disable", "enable"]);
  assert.deepEqual(Object.keys(sessions), ["create", "update", "revoke", "revokeForUser", "listForUser", "deleteExpired"]);
  assert.deepEqual(Object.keys(recovery), ["create", "findByTokenHash", "consume", "consumeForUser"]);

  const created = await accounts.create(account("usr_ada", "ada@example.com"));
  assert.deepEqual(created, await backend.withTransaction((tx) => tx.users.findById("usr_ada")));
  assert.deepEqual(await accounts.findByEmail("ada@example.com"), created);
  assert.equal(await accounts.findByEmail("nobody@example.com"), null);
  await assert.rejects(accounts.create(account("usr_other", "ada@example.com")), { status: 409, code: "auth.local.accounts.exists", message: "An account with this id or email already exists." });

  const failure = new Error("rolled back");
  await assert.rejects(inCallerTransaction(async (options) => {
    await accounts.create(account("usr_bob", "bob@example.com"), options);
    assert.equal((await accounts.findByEmail("bob@example.com", options)).id, "usr_bob", "seen inside the transaction");
    assert.equal(await accounts.findByEmail("bob@example.com"), null, "not outside it before the commit");
    assert.deepEqual((await accounts.updatePassword("usr_ada", NEXT_PASSWORD, options)).password, NEXT_PASSWORD);
    assert.equal((await accounts.updateProfile("usr_ada", { displayName: "Renamed" }, options)).displayName, "Renamed");
    assert.notEqual((await accounts.markEmailVerified("usr_ada", options)).emailVerifiedAt, "");
    await sessions.create({ id: "ses_one", userId: "usr_ada", tokenHash: "hash-one", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: CREATED }, options);
    assert.notEqual((await sessions.revoke("ses_one", options)).revokedAt, "");
    await recovery.create({ id: "rec_one", userId: "usr_ada", tokenHash: "hash-rec", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: CREATED }, options);
    assert.notEqual((await recovery.consume("rec_one", options)).usedAt, "");
    throw failure;
  }), (error) => error === failure);
  assert.equal(await accounts.findByEmail("bob@example.com"), null);
  assert.deepEqual(await accounts.findByEmail("ada@example.com"), created, "the rolled-back updates are gone");
  assert.equal(await recovery.findByTokenHash("hash-rec"), null);
  assert.equal(await sessions.revoke("ses_one"), null);

  await inCallerTransaction(async (options) => {
    await sessions.create({ id: "ses_live", userId: "usr_ada", tokenHash: "hash-live", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: CREATED }, options);
    await sessions.create({ id: "ses_kept", userId: "usr_ada", tokenHash: "hash-kept", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: CREATED }, options);
    await sessions.create({ id: "ses_old", userId: "usr_ada", tokenHash: "hash-old", expiresAt: "2026-11-01T00:00:00.000Z", createdAt: CREATED }, options);
    await recovery.create({ id: "rec_open", userId: "usr_ada", tokenHash: "hash-open", expiresAt: "2026-12-01T00:00:00.000Z", createdAt: CREATED }, options);
  });
  assert.equal(await sessions.revokeForUser("usr_ada", { exceptSessionId: "ses_kept" }), 2, "ses_live and ses_old");
  assert.equal(await sessions.deleteExpired("2026-11-08T00:00:00.000Z"), 1);
  assert.equal(await recovery.consumeForUser("usr_ada", { idPrefix: "rec_" }), 1);
  const verified = await accounts.markEmailVerified("usr_ada");
  assert.equal((await accounts.markEmailVerified("usr_ada")).emailVerifiedAt, verified.emailVerifiedAt);
  assert.equal(await accounts.updatePassword("usr_missing", NEXT_PASSWORD), null);
  assert.equal(await accounts.updateProfile("usr_missing", { displayName: "X" }), null);
  assert.equal(await accounts.markEmailVerified("usr_missing"), null);
});

test("every local sign-in table is a table resource or one of LOCAL_AUTH_INFRASTRUCTURE_TABLES", async (context) => {
  const { knex, resourceRuntime } = await openLocalAuthDatabase(context, "da_local_tables");
  await expectEveryTableOwned({ knex, runtime: resourceRuntime, infrastructureTables: LOCAL_AUTH_INFRASTRUCTURE_TABLES, environment: process.env });
  await assert.rejects(expectEveryTableOwned({ knex, runtime: resourceRuntime, environment: process.env }), /Tables no feature owns: auth_local_identities\./u);
});

test("the local sign-in table resources declare exactly the foreign keys the migrations create", async (context) => {
  const { knex } = await openLocalAuthDatabase(context, "da_local_keys");
  const tables = LOCAL_AUTH_RESOURCES.map((resource) => resource.tableName);
  assert.deepEqual(await checkForeignKeys({ knex, resources: LOCAL_AUTH_RESOURCES, tables }), { missing: [], undeclared: [] });
});
