import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { authPolicyPlugin } from "@jskit-ai/auth-core/server/lib/plugin";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { sha256Base64url } from "../src/server/lib/tokens.js";
import { localServiceOptions } from "../test-support/localService.js";
import { sessionCookies } from "../test-support/passSignInScenario.js";
import { FIREFOX, PHONE, exerciseSignInFacts } from "../test-support/signInFactsScenario.js";
import { requestFrom } from "../test-support/sessionMetadataScenario.js";

const PASSWORD = "correct horse battery staple";

async function temporaryStore(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-sign-in-facts-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  return storeDir;
}

test("a session keeps how it was signed in, and an account when its credentials changed (file backend)", async (t) => {
  await exerciseSignInFacts(t, createLocalFileBackend({ storeDir: await temporaryStore(t) }));
});

test("a session and an account the file backend stored before it kept these facts have none, and visits add none", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-23T09:00:00.000Z") });
  const storeDir = await temporaryStore(t);
  const field = (value) => Buffer.from(value, "utf8").toString("base64url");
  const refreshToken = "a refresh token from before";
  // A thirteen-field account and a thirteen-field session, as the release before wrote them.
  const user = ["user", "v1", "usr_old", field("old@example.com"), field("Old"), "scrypt", "1", "salt", "hash",
    field("2026-11-01T09:00:00.000Z"), field("2026-11-01T09:00:00.000Z"), "0", field("")].join(":");
  const session = ["session", "v1", "ses_old", "usr_old", sha256Base64url(refreshToken), "normal",
    field("2026-11-20T09:00:00.000Z"), field("2026-12-20T09:00:00.000Z"), field(""), field(""),
    field("203.0.113.7"), field(FIREFOX), field("2026-11-20T09:00:00.000Z")].join(":");
  await fs.writeFile(path.join(storeDir, "users.passwd"), `${user}\n`);
  await fs.writeFile(path.join(storeDir, "sessions.passwd"), `${session}\n`);
  const backend = createLocalFileBackend({ storeDir });
  const service = createLocalAuthService({ ...localServiceOptions(), backend });

  const visit = () => service.authenticateRequest(requestFrom("203.0.113.7", FIREFOX, { jskit_local_refresh_token: refreshToken }));
  const first = await visit();
  assert.equal(first.authenticated, true);
  assert.deepEqual(first.signIn, { at: "2026-11-20T09:00:00.000Z", ip: "", userAgent: "", purpose: "normal" },
    "an older session has no sign-in address or browser, so an action that asks for them refuses it");
  assert.deepEqual(first.credentialsChangedAt, { password: "", email: "" });
  // The visit rewrote the records in the current form; where it was signed in from stays unknown.
  const stored = await backend.withTransaction((tx) => tx.sessions.findById("ses_old"));
  assert.deepEqual([stored.ip, stored.userAgent, stored.signInIp, stored.signInUserAgent], ["203.0.113.7", FIREFOX, "", ""]);
  assert.equal((await fs.readFile(path.join(storeDir, "sessions.passwd"), "utf8")).trim().split(":").length, 15);
  assert.deepEqual((await visit()).signIn, first.signIn);
});

test("the auth policy hands a route the session's sign-in and the account's credential changes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-23T09:00:00.000Z") });
  const backend = createLocalFileBackend({ storeDir: await temporaryStore(t) });
  const service = createLocalAuthService({ ...localServiceOptions(), backend });
  const app = Fastify();
  t.after(() => app.close());
  await authPolicyPlugin({
    resolveActor: (request) => service.authenticateRequest(request),
    hasPermission: () => true
  }, { appEnv: "test" })(app);
  const facts = (request) => ({ sessionSignIn: request.sessionSignIn, credentialsChangedAt: request.credentialsChangedAt });
  app.get("/api/account/facts", { config: { authPolicy: "required" } }, (request) => facts(request));
  app.get("/api/public/facts", { config: { authPolicy: "public" } }, (request) => facts(request));

  await service.register({ email: "ada@example.com", password: PASSWORD }, requestFrom("192.0.2.1", PHONE));
  const signedIn = await service.login({ email: "ada@example.com", password: PASSWORD }, requestFrom("203.0.113.7", FIREFOX));
  const asked = await app.inject({
    method: "GET",
    url: "/api/account/facts",
    remoteAddress: "198.51.100.9",
    headers: { "user-agent": PHONE },
    cookies: sessionCookies(signedIn.session)
  });
  assert.equal(asked.statusCode, 200);
  assert.deepEqual(asked.json(), {
    sessionSignIn: { at: "2026-11-23T09:00:00.000Z", ip: "203.0.113.7", userAgent: FIREFOX, purpose: "normal" },
    credentialsChangedAt: { password: "", email: "" }
  }, "the sign-in's address and browser, not the asking request's");

  const signedOut = await app.inject({ method: "GET", url: "/api/account/facts" });
  assert.equal(signedOut.statusCode, 401);
  const publicRoute = await app.inject({ method: "GET", url: "/api/public/facts", cookies: sessionCookies(signedIn.session) });
  assert.deepEqual(publicRoute.json(), { sessionSignIn: null, credentialsChangedAt: null }, "a public route signs nobody in");
});
