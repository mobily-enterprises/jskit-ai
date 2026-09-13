import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, writeFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileConnectionStore, createCredentialProtection } from "../src/server/fileStorage.js";

const identity = { owner: { applicationId: "app", subjectId: "user" }, integrationId: "calendar" };
const key = new Uint8Array(32).fill(7);
const protection = () => createCredentialProtection({ keys: { current: key }, activeKeyId: "current" });
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "connector-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "connections");
  return { root, directory, store: createFileConnectionStore({ directory, protection: protection() }) };
}

test("JSON connection records survive restart with encrypted credentials and single-use attempts", async (t) => {
  const { directory, store } = await fixture(t);
  const connection = { status: "connected", tokens: { accessToken: "private-access", refreshToken: "private-refresh" } };
  await store.withConnection(identity, async ({ save, putAttempt }) => {
    await save(connection);
    await putAttempt({ state: "one-time-state", codeVerifier: "private-verifier", expiresAt: Date.now() + 60_000 });
  });
  const [name] = await readdir(directory);
  assert.match(name, /^[a-f0-9]{64}\.json$/u);
  const text = await readFile(path.join(directory, name), "utf8");
  assert.equal(JSON.parse(text).schemaVersion, 1);
  assert.equal(/private-|one-time-state/u.test(text), false);
  assert.equal((await stat(path.join(directory, name))).mode & 0o077, 0);
  const restarted = createFileConnectionStore({ directory, protection: protection() });
  await restarted.withConnection(identity, async ({ connection: actual, consumeAttempt }) => {
    assert.deepEqual(actual, connection);
    assert.equal((await consumeAttempt("one-time-state")).codeVerifier, "private-verifier");
  });
  await store.withConnection(identity, async ({ consumeAttempt }) => assert.equal(await consumeAttempt("one-time-state"), null));
});

test("failed callbacks and failed writes preserve the prior complete JSON record", async (t) => {
  const { directory, store } = await fixture(t);
  await store.withConnection(identity, async ({ save }) => save({ version: 1 }));
  await assert.rejects(store.withConnection(identity, async ({ save, putAttempt }) => {
    await save({ version: 2 });
    await putAttempt({ state: "uncommitted", expiresAt: Date.now() + 60_000 });
    throw new Error("interrupted operation");
  }), /interrupted operation/u);
  const brokenWriter = createFileConnectionStore({ directory, protection: { ...protection(), seal: async () => { throw new Error("vault unavailable"); } } });
  await assert.rejects(brokenWriter.withConnection(identity, async ({ save }) => save({ version: 3 })), /vault unavailable/u);
  await store.withConnection(identity, async ({ connection, consumeAttempt }) => {
    assert.deepEqual(connection, { version: 1 });
    assert.equal(await consumeAttempt("uncommitted"), null);
  });
  assert.equal((await readdir(directory)).length, 1);
});

test("owner bindings reject copied records and malformed JSON is never replaced", async (t) => {
  const { directory, store } = await fixture(t);
  await store.withConnection(identity, async ({ save }) => save({ secret: "first-account" }));
  const first = (await readdir(directory))[0];
  const other = { ...identity, owner: { ...identity.owner, subjectId: "other-user" } };
  await store.withConnection(other, async ({ connection, save }) => {
    assert.equal(connection, null);
    await save({ secret: "second-account" });
  });
  const second = (await readdir(directory)).find((name) => name !== first);
  await writeFile(path.join(directory, second), await readFile(path.join(directory, first)));
  await assert.rejects(store.withConnection(other, () => assert.fail("must not expose copied credentials")), { code: "connector_storage_invalid" });
  await writeFile(path.join(directory, first), "broken-json");
  await assert.rejects(store.withConnection(identity, async ({ save }) => save({ replaced: true })), { code: "connector_storage_invalid" });
  assert.equal(await readFile(path.join(directory, first), "utf8"), "broken-json");
});

test("disconnect removes pending attempts and expired attempts cannot resume", async (t) => {
  const { directory } = await fixture(t);
  let now = 1000;
  const store = createFileConnectionStore({ directory, protection: protection(), now: () => now });
  await store.withConnection(identity, async ({ save, putAttempt }) => {
    await save({ status: "connected" });
    await putAttempt({ state: "expired", expiresAt: 2000 });
    await putAttempt({ state: "pending", expiresAt: 9000 });
  });
  now = 3000;
  await store.withConnection(identity, async ({ consumeAttempt, remove }) => {
    assert.equal(await consumeAttempt("expired"), null);
    await remove();
  });
  await store.withConnection(identity, async ({ connection, consumeAttempt }) => {
    assert.equal(connection, null);
    assert.equal(await consumeAttempt("pending"), null);
  });
});

test("symlinked files and directories are rejected without modifying their targets", async (t) => {
  const { root, directory, store } = await fixture(t);
  await store.withConnection(identity, async ({ save }) => save({ first: true }));
  const file = path.join(directory, (await readdir(directory))[0]);
  const external = path.join(root, "outside.json");
  await writeFile(external, "keep-me");
  await rm(file);
  await symlink(external, file);
  await assert.rejects(store.withConnection(identity, async ({ save }) => save({ overwritten: true })), { code: "connector_storage_invalid" });
  assert.equal(await readFile(external, "utf8"), "keep-me");
  const alias = path.join(root, "alias");
  await symlink(directory, alias);
  const aliased = createFileConnectionStore({ directory: alias, protection: protection() });
  await assert.rejects(aliased.withConnection(identity, () => {}), { code: "connector_storage_invalid" });
});

test("independent processes serialize updates to the same connection", async (t) => {
  const { directory, store } = await fixture(t);
  await store.withConnection(identity, async ({ save }) => save({ count: 0 }));
  const moduleUrl = new URL("../src/server/fileStorage.js", import.meta.url).href;
  const source = `
    import { createFileConnectionStore, createCredentialProtection } from ${JSON.stringify(moduleUrl)};
    import { setTimeout } from 'node:timers/promises';
    const store = createFileConnectionStore({ directory: process.argv[1], protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: 'current' }) });
    for (let i = 0; i < 3; i++) await store.withConnection(${JSON.stringify(identity)}, async ({ connection, save }) => {
      await setTimeout(15);
      await save({ count: connection.count + 1 });
    });
  `;
  await Promise.all([1, 2, 3].map(() => promisify(execFile)(process.execPath, ["--input-type=module", "-e", source, directory])));
  await store.withConnection(identity, ({ connection }) => assert.equal(connection.count, 9));
  assert.equal((await readdir(directory)).filter((file) => file.endsWith(".tmp") || file.endsWith(".lock")).length, 0);
});


test("pending OAuth resumes after reopening the app store without exposing private attempt fields", async (t) => {
  const { directory } = await fixture(t);
  const { createConnectionService } = await import("../src/server/index.js");
  const { googleCalendarProvider } = await import("../../connector-google-calendar/src/server/provider.js");
  let clock = 1000;
  const configuration = {
    schemaVersion: 1,
    integrations: { calendar: { provider: "google-calendar", accountMode: "shared",
      scopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly"],
      authentication: { method: "oauth2", registrationRef: "google" } } },
    registrations: { google: { source: "own", clientId: "fixture-client", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK" } }
  };
  const makeService = (config = configuration) => createConnectionService({
    configuration: config, providers: [googleCalendarProvider],
    store: createFileConnectionStore({ directory, protection: protection(), now: () => clock }),
    authorize: async (context) => context,
    resolveReference: async (ref) => ref === "env:CALLBACK" ? "https://app.example/integrations/google/callback" : "fixture-private-secret",
    now: () => clock, fetchImpl: async () => { throw new Error("Resume must not call provider"); }
  });
  const input = { context: identity.owner, integrationId: "calendar" };
  const first = await makeService().beginAuthorization(input);
  const restarted = makeService();
  assert.deepEqual(await restarted.resumeAuthorization(input), first);
  assert.deepEqual(Object.keys(first).sort(), ["authorizationUrl", "callbackUrl", "expiresAt"]);
  assert.equal(await restarted.resumeAuthorization({ ...input, context: { ...identity.owner, applicationId: "other-app" } }), null);
  assert.equal(await restarted.resumeAuthorization({ ...input, context: { ...identity.owner, subjectId: "other-user" } }), null);
  const changed = structuredClone(configuration);
  changed.registrations.google.clientId = "different-client";
  assert.equal(await makeService(changed).resumeAuthorization(input), null);
  const state = new URL(first.authorizationUrl).searchParams.get("state");
  await restarted.cancelAuthorization({ ...input, state });
  assert.equal(await makeService().resumeAuthorization(input), null);
  await restarted.beginAuthorization(input);
  clock += 600001;
  assert.equal(await makeService().resumeAuthorization(input), null);
});
