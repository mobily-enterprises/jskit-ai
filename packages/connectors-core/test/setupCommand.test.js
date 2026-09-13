import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService, createEnvironmentReferenceResolver } from "../src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../src/server/fileStorage.js";
import { googleCalendarProvider } from "../../connector-google-calendar/src/server/provider.js";
import { resendProvider } from "../../connectors-catalog/src/server/resend.js";
import { gmailProvider } from "../../connectors-catalog/src/server/gmail.js";

// Execute the authored composition example so documentation cannot drift from
// the runtime. This trusted repository text is never supplied by an app user.
const guide = await readFile(new URL("../docs/setup-command.md", import.meta.url), "utf8");
const source = guide.match(/```js\n([\s\S]*?)\n```/u)?.[1];
assert.ok(source, "The setup guide must contain its dispatch example.");
const dispatchSetup = new Function(`${source}\nreturn dispatchSetup;`)();
const scope = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const callback = "http://127.0.0.1:8080/integrations/google/callback";
const context = { applicationId: "dogandgroom-dev", subjectId: "business-account" };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "setup-composition-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configuration = {
    schemaVersion: 1,
    registrations: { google: { source: "own", clientId: "fixture-client",
      clientSecretRef: "env:GOOGLE_SECRET", callbackUrlRef: "env:CALLBACK" } },
    integrations: {
      calendar: { provider: "google-calendar", accountMode: "shared", scopes: [scope],
        authentication: { method: "oauth2", registrationRef: "google" }, settings: {} },
      inbox: { provider: "gmail", accountMode: "shared", scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        authentication: { method: "oauth2", registrationRef: "google" }, settings: {} },
      mail: { provider: "resend", accountMode: "shared", scopes: [],
        authentication: { method: "api-key", secretRef: "env:RESEND_KEY" }, settings: {} }
    }
  };
  const env = { GOOGLE_SECRET: "private-google", CALLBACK: callback, RESEND_KEY: "private-resend" };
  const requests = [];
  const tokenGrants = [];
  let time = Date.now();
  const restart = (runtimeDirectory = directory) => createConnectionService({
    configuration, providers: [googleCalendarProvider, resendProvider, gmailProvider],
    now: () => time,
    store: createFileConnectionStore({ directory: runtimeDirectory, protection: createCredentialProtection({
      activeKeyId: "test", keys: { test: new Uint8Array(32).fill(7) }
    }) }),
    authorize: async (identity) => identity,
    resolveReference: createEnvironmentReferenceResolver(env),
    fetchImpl: async (url, init) => {
      requests.push(String(url));
      if (String(url) === "https://oauth2.googleapis.com/token") {
        tokenGrants.push(new URLSearchParams(init.body).get("grant_type"));
        return Response.json({
          token_type: "Bearer", access_token: "private-access", refresh_token: "private-refresh",
          expires_in: 3600, scope: `${scope} https://www.googleapis.com/auth/gmail.readonly`
        });
      }
      if (String(url).startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
        return Response.json({ kind: "calendar#calendarList", items: [] });
      }
      if (String(url) === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
        return Response.json({ emailAddress: "business@example.test", messagesTotal: 3 });
      }
      if (String(url).startsWith("https://api.resend.com/domains")) {
        assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${env.RESEND_KEY}`);
        if (env.RESEND_KEY === "private-rejected") return Response.json({ message: "Invalid key" }, { status: 401 });
        return Response.json({ object: "list", data: [], has_more: false });
      }
      assert.fail(`Unexpected provider request: ${url}`);
    }
  });
  const dispatch = async (operation, integrationId, extra = {}, identity = context) => {
    const result = await dispatchSetup({ protocol: "vibe64.integration-setup.command.v1",
      requestId: "fixture-request", operation, integrationId, ...extra },
    { configuration, connections: restart(), context: identity });
    assert.equal(result.requestId, "fixture-request");
    assert.equal(JSON.stringify(result).includes("private-"), false);
    return result;
  };
  return { dispatch, restart, env, requests, tokenGrants, configuration, directory, advance: (milliseconds) => { time += milliseconds; } };
}

test("documented dispatcher crosses a CLI process boundary with Env credentials and persistent state", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "setup-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = path.join(directory, "setup.mjs");
  const configuration = { schemaVersion: 1, registrations: {}, integrations: {
    mail: { provider: "resend", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:RESEND_KEY" }, settings: {} }
  } };
  await writeFile(path.join(directory, "integrations.json"), JSON.stringify(configuration));
  // Test-only CLI bootstrap. The authored dispatcher remains the code under test;
  // provider HTTP is controlled, while stdin, Env and encrypted files are real.
  await writeFile(command, `
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createConnectionService, createEnvironmentReferenceResolver } from ${JSON.stringify(new URL("../src/server/index.js", import.meta.url).href)};
import { createFileConnectionStore, createCredentialProtection } from ${JSON.stringify(new URL("../src/server/fileStorage.js", import.meta.url).href)};
import { resendProvider } from ${JSON.stringify(new URL("../../connectors-catalog/src/server/resend.js", import.meta.url).href)};
${source}
try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 32768) throw new Error("Input too large");
  }
  const configuration = JSON.parse(await readFile("integrations.json", "utf8"));
  const context = { applicationId: process.env.APP_ID, subjectId: "setup-operator" };
  const connections = createConnectionService({ configuration, providers: [resendProvider],
    resolveReference: createEnvironmentReferenceResolver(process.env),
    store: createFileConnectionStore({ directory: path.resolve("state"), protection: createCredentialProtection({
      activeKeyId: "fixture", keys: { fixture: Buffer.from(process.env.STORE_KEY, "hex") }
    }) }),
    authorize: async (identity) => {
      if (identity.applicationId !== context.applicationId || identity.subjectId !== context.subjectId) throw new Error("Wrong operator");
      return identity;
    },
    fetchImpl: async (url, init) => {
      if (process.env.ALLOW_PROVIDER_CHECK !== "1" || String(url) !== "https://api.resend.com/domains?limit=20" ||
          new Headers(init.headers).get("authorization") !== "Bearer fixture-private-key") throw new Error("Unexpected provider request");
      return Response.json({ object: "list", data: [], has_more: false });
    }
  });
  const result = await dispatchSetup(JSON.parse(input), { configuration, connections, context });
  process.stdout.write(JSON.stringify(result) + "\\n");
} catch {
  process.stderr.write("Integration setup failed.\\n");
  process.exitCode = 1;
}
`);
  const request = { protocol: "vibe64.integration-setup.command.v1", requestId: "cli-request", integrationId: "mail" };
  for (const [operation, key, applicationId, expected, allowCheck] of [
    ["status", "MISSING", "first-app", "unconfigured", false],
    ["connect", "MISSING", "first-app", "unconfigured", false],
    ["connect", "fixture-private-key", "first-app", "connected", true],
    ["status", "fixture-private-key", "first-app", "connected", false],
    ["status", "fixture-private-key", "other-app", "disconnected", false],
    ["disconnect", "fixture-private-key", "first-app", "disconnected", false],
    ["status", "fixture-private-key", "first-app", "disconnected", false]
  ]) {
    const { stdout, stderr } = await new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [command], { cwd: directory, timeout: 5000, maxBuffer: 32768,
        env: { APP_ID: applicationId, RESEND_KEY: key, STORE_KEY: "07".repeat(32),
          ALLOW_PROVIDER_CHECK: allowCheck ? "1" : "0" }
      }, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
      child.stdin.end(JSON.stringify({ ...request, operation }) + "\n");
    });
    assert.equal(stderr, "");
    assert.equal(stdout.trim().split("\n").length, 1);
    assert.equal(stdout.includes("fixture-private-key"), false);
    assert.equal(stdout.includes("07".repeat(32)), false);
    const result = JSON.parse(stdout);
    assert.equal(result.protocol, request.protocol);
    assert.equal(result.requestId, request.requestId);
    assert.equal(result.status, expected);
  }
  const failure = await new Promise((resolve) => {
    const child = execFile(process.execPath, [command], { cwd: directory, timeout: 5000, maxBuffer: 32768,
      env: { APP_ID: "first-app", RESEND_KEY: "fixture-private-key", STORE_KEY: "07".repeat(32) }
    }, (error, stdout, stderr) => resolve({ code: error?.code, stdout, stderr }));
    child.stdin.end("invalid-json-with-fixture-private-key\n");
  });
  assert.deepEqual(failure, { code: 1, stdout: "", stderr: "Integration setup failed.\n" });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "integrations.json"), "utf8")), configuration);
});

test("documented setup returns a verified mailbox label after restart and removes it on disconnect", async (t) => {
  const { dispatch, restart, requests, env, configuration } = await fixture(t);
  const pending = await dispatch("connect", "inbox");
  assert.equal(pending.accountLabel, undefined);
  await restart().completeAuthorization({ context, integrationId: "inbox",
    callbackUrl: `${callback}?code=fixture-code&state=${pending.attemptId}` });
  assert.equal((await dispatch("status", "inbox")).accountLabel, "business@example.test");
  const replacement = await dispatch("connect", "inbox");
  assert.equal(replacement.accountLabel, undefined);
  await dispatch("cancel", "inbox", { attemptId: replacement.attemptId });
  assert.equal((await dispatch("status", "inbox")).accountLabel, "business@example.test");
  const requestCount = requests.length;
  const previousEnv = { ...env };
  const previousConfiguration = structuredClone(configuration);
  assert.equal((await dispatch("disconnect", "inbox")).accountLabel, undefined);
  assert.equal((await dispatch("status", "inbox")).accountLabel, undefined);
  assert.equal(requests.length, requestCount);
  assert.deepEqual(env, previousEnv);
  assert.deepEqual(configuration, previousConfiguration);
});

test("two Gmail slots sharing a registration keep pending consent and grants independent", async (t) => {
  const { dispatch, restart, configuration } = await fixture(t);
  configuration.integrations["second-inbox"] = structuredClone(configuration.integrations.inbox);
  const first = await dispatch("connect", "inbox");
  const second = await dispatch("connect", "second-inbox");
  assert.notEqual(first.attemptId, second.attemptId);
  await assert.rejects(restart().completeAuthorization({ context, integrationId: "second-inbox",
    callbackUrl: `${callback}?code=fixture-code&state=${first.attemptId}` }));
  await restart().completeAuthorization({ context, integrationId: "inbox",
    callbackUrl: `${callback}?code=fixture-code&state=${first.attemptId}` });
  assert.equal((await dispatch("status", "inbox")).status, "connected");
  assert.equal((await dispatch("status", "second-inbox")).attemptId, second.attemptId);
  await dispatch("cancel", "second-inbox", { attemptId: second.attemptId });
  assert.equal((await dispatch("status", "inbox")).status, "connected");
  const replacement = await dispatch("connect", "second-inbox");
  await restart().completeAuthorization({ context, integrationId: "second-inbox",
    callbackUrl: `${callback}?code=fixture-code&state=${replacement.attemptId}` });
  await dispatch("disconnect", "inbox");
  assert.equal((await dispatch("status", "inbox")).status, "disconnected");
  assert.equal((await dispatch("status", "second-inbox")).status, "connected");
});

test("moving application state preserves grants and refresh while invalidating consent for the old callback", async (t) => {
  const { dispatch, restart, env, directory, advance, requests, tokenGrants } = await fixture(t);
  const pending = await dispatch("connect", "calendar");
  const input = { context, integrationId: "calendar" };
  await restart().completeAuthorization({ ...input,
    callbackUrl: `${callback}?code=fixture-code&state=${pending.attemptId}` });
  await dispatch("connect", "mail");
  await dispatch("connect", "calendar");
  const moved = `${directory}-relocated`;
  t.after(() => rm(moved, { recursive: true, force: true }));
  await rename(directory, moved);
  env.CALLBACK = "https://dogandgroom.example/integrations/google/callback";
  const relocated = restart(moved);
  const requestCount = requests.length;
  assert.equal(await relocated.resumeAuthorization(input), null);
  assert.equal((await relocated.status(input)).status, "connected");
  assert.equal((await relocated.status(input)).callbackUrl, env.CALLBACK);
  assert.equal((await relocated.status({ context, integrationId: "mail" })).status, "connected");
  assert.equal(requests.length, requestCount);
  advance(3_600_001);
  await relocated.invoke({ ...input, operation: "calendars.list" });
  assert.deepEqual(tokenGrants, ["authorization_code", "refresh_token"]);
  assert.deepEqual(requests.slice(requestCount).map((url) => new URL(url).hostname), [
    "oauth2.googleapis.com", "www.googleapis.com"
  ]);
  assert.equal((await restart(moved).status(input)).status, "connected");
  const otherEnvironment = { ...context, applicationId: "dogandgroom-production" };
  assert.equal((await relocated.status({ ...input, context: otherEnvironment })).status, "disconnected");
  await relocated.disconnect({ ...input, context: otherEnvironment });
  assert.equal((await relocated.status(input)).status, "connected");
});

test("documented OAuth setup resumes across restarts, preserves a grant on cancel and isolates apps", async (t) => {
  const { dispatch, restart, env, requests } = await fixture(t);
  env.GOOGLE_SECRET = "MISSING";
  assert.equal((await dispatch("status", "calendar")).setupIssue, "credentials-missing");
  env.GOOGLE_SECRET = "private-google";
  env.CALLBACK = "not-a-callback";
  assert.equal((await dispatch("status", "calendar")).setupIssue, "callback-invalid");
  env.CALLBACK = callback;
  assert.equal((await dispatch("status", "calendar")).status, "disconnected");
  assert.equal((await dispatch("status", "calendar")).callbackUrl, callback);
  assert.equal(requests.length, 0);
  const pending = await dispatch("connect", "calendar");
  assert.equal(pending.status, "pending");
  assert.equal(pending.callbackUrl, callback);
  assert.deepEqual(await dispatch("status", "calendar"), pending);
  const callbackUrl = `${callback}?code=fixture-code&state=${pending.attemptId}`;
  await restart().completeAuthorization({ context, integrationId: "calendar", callbackUrl });
  assert.equal((await dispatch("status", "calendar")).status, "connected");
  env.CALLBACK = "https://dogandgroom.example/integrations/google/callback";
  assert.equal((await dispatch("status", "calendar")).callbackUrl, env.CALLBACK);
  env.CALLBACK = callback;
  const replacement = await dispatch("connect", "calendar");
  assert.equal((await dispatch("cancel", "calendar", { attemptId: replacement.attemptId })).status, "cancelled");
  assert.equal((await dispatch("status", "calendar")).status, "connected");
  await assert.rejects(restart().completeAuthorization({ context, integrationId: "calendar",
    callbackUrl: `${callback}?code=fixture-code&state=${replacement.attemptId}` }));
  const otherApp = { ...context, applicationId: "another-app" };
  assert.equal((await dispatch("status", "calendar", {}, otherApp)).status, "disconnected");
  await dispatch("disconnect", "calendar", {}, otherApp);
  assert.equal((await dispatch("status", "calendar")).status, "connected");
  const count = requests.length;
  env.GOOGLE_SECRET = "MISSING";
  assert.equal((await dispatch("status", "calendar")).status, "reconnect-required");
  assert.equal(requests.length, count);
  assert.equal((await dispatch("disconnect", "calendar")).status, "disconnected");
});

test("individual Calendar accounts keep consent and grants separate across runtime restarts", async (t) => {
  const { configuration, restart, dispatch } = await fixture(t);
  configuration.integrations.calendar.accountMode = "per-user";
  const alice = { ...context, subjectId: "alice" };
  const bob = { ...context, subjectId: "bob" };
  const input = (identity) => ({ context: identity, integrationId: "calendar" });
  const alicePending = await restart().beginAuthorization(input(alice));
  const bobPending = await restart().beginAuthorization(input(bob));
  const callbackFor = (pending) => `${callback}?code=fixture-code&state=${new URL(pending.authorizationUrl).searchParams.get("state")}`;
  await assert.rejects(restart().completeAuthorization({ ...input(bob), callbackUrl: callbackFor(alicePending) }), {
    code: "connector_attempt_invalid"
  });
  await restart().completeAuthorization({ ...input(alice), callbackUrl: callbackFor(alicePending) });
  assert.equal((await restart().status(input(alice))).status, "connected");
  assert.equal((await restart().status(input(bob))).status, "disconnected");
  assert.deepEqual(await restart().resumeAuthorization(input(bob)), bobPending);
  await restart().completeAuthorization({ ...input(bob), callbackUrl: callbackFor(bobPending) });
  await restart().disconnect(input(alice));
  assert.equal((await restart().status(input(alice))).status, "disconnected");
  assert.equal((await restart().status(input(bob))).status, "connected");
  await assert.rejects(dispatch("connect", "calendar"), /Individual users connect inside the application/u);
});

test("documented key setup verifies explicitly, survives restart and reports incomplete credentials", async (t) => {
  const { dispatch, env, requests, configuration, advance } = await fixture(t);
  assert.equal((await dispatch("status", "mail")).status, "disconnected");
  assert.equal(requests.length, 0);
  assert.equal((await dispatch("connect", "mail")).status, "connected");
  assert.equal((await dispatch("status", "mail")).status, "connected");
  assert.equal(requests.length, 1);
  env.RESEND_KEY = "MISSING";
  assert.equal((await dispatch("status", "mail")).status, "reconnect-required");
  await dispatch("disconnect", "mail");
  const readiness = await dispatch("status", "mail");
  assert.equal(readiness.status, "unconfigured");
  assert.equal(readiness.setupIssue, "credentials-missing");
  const incomplete = await dispatch("connect", "mail");
  assert.equal(incomplete.status, "unconfigured");
  assert.equal(incomplete.setupIssue, "credentials-missing");
  assert.equal(requests.length, 1);
  env.RESEND_KEY = "private-replacement";
  assert.equal((await dispatch("connect", "mail")).status, "connected");
  assert.equal(requests.length, 2);
  const previous = await dispatch("status", "mail");
  env.RESEND_KEY = "private-rejected";
  advance(1000);
  await assert.rejects(dispatch("connect", "mail"), { code: "connector_reconnect_required" });
  assert.deepEqual(await dispatch("status", "mail"), { ...previous, status: "reconnect-required" },
    "The replacement key must not inherit the previous key's verified status.");
  env.RESEND_KEY = "private-replacement";
  assert.deepEqual(await dispatch("status", "mail"), previous, "A failed check must preserve the last successful binding.");
  assert.equal(requests.length, 3);
  env.RESEND_KEY = "private-valid-replacement";
  const verified = await dispatch("connect", "mail");
  assert.equal(verified.status, "connected");
  assert.ok(verified.verifiedAt > previous.verifiedAt);
  assert.equal(requests.length, 4);
  configuration.integrations.calendar.accountMode = "per-user";
  await assert.rejects(dispatch("connect", "calendar"), /Individual users connect inside the application/u);
});

test("documented OAuth setup consumes denied and repeated callbacks without replacing a previous grant", async (t) => {
  const { dispatch, restart, requests } = await fixture(t);
  const first = await dispatch("connect", "calendar");
  const complete = (attempt, suffix) => restart().completeAuthorization({
    context, integrationId: "calendar",
    callbackUrl: `${callback}?${suffix}&state=${attempt.attemptId}`
  });
  await complete(first, "code=fixture-code");
  const connected = await dispatch("status", "calendar");
  assert.equal(connected.status, "connected");
  const verifiedRequests = requests.length;
  await assert.rejects(complete(first, "code=fixture-code"), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, verifiedRequests);
  assert.deepEqual(await dispatch("status", "calendar"), connected);

  const replacement = await dispatch("connect", "calendar");
  await assert.rejects(complete(replacement, "error=access_denied"), { code: "connector_consent_denied" });
  assert.equal(requests.length, verifiedRequests);
  assert.deepEqual(await dispatch("status", "calendar"), connected);
  await assert.rejects(complete(replacement, "code=late-code"), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, verifiedRequests);
  assert.deepEqual(await dispatch("status", "calendar"), connected);
});
