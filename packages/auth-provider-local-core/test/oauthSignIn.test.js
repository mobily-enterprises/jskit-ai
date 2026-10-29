import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { decodeJwt, generateKeyPair, SignJWT } from "jose";
import { createService as createProfileSyncService } from "../../users-core/src/server/common/services/authProfileSyncService.js";
import { createLocalAuthRegisterHookDecorator, createLocalFileBackend } from "../src/server/lib/index.js";
import { sha256Base64url } from "../src/server/lib/tokens.js";
import { resolveConfig } from "../src/server/providers/AuthLocalProvider.js";
import {
  APP_URL,
  ATTEMPT_COOKIE,
  approveAtProvider,
  createService,
  oidcProviderEntry,
  sessionCookies,
  startFakeGitHub,
  startOidcProvider
} from "../test-support/oauthHarness.js";

const MICROSOFT_CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";
const UNVERIFIED = { statusCode: 401, code: "auth.local.oauth.unverified" };
const EXPIRED = { statusCode: 400, code: "auth.local.oauth.expired" };

async function fileBackend() {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-oauth-"));
  return createLocalFileBackend({ storeDir });
}

/**
 * The users-core profile sync service over memory repositories. Its lifecycle
 * contributor stands where workspaces-core registers personal-workspace
 * provisioning (`afterIdentityProfileSynced`).
 */
function createUsersProfileSync() {
  const profiles = [];
  const provisioned = [];
  const profileProjector = createProfileSyncService({
    userProfilesRepository: {
      async findByIdentity(identity) {
        return profiles.find((profile) => profile.authProviderUserSid === identity.providerUserId) || null;
      },
      async upsert(payload) {
        const existing = profiles.find((profile) => profile.authProviderUserSid === payload.authProviderUserSid);
        if (existing) return Object.assign(existing, payload);
        const profile = { id: String(profiles.length + 1), ...payload };
        profiles.push(profile);
        return profile;
      },
      async withTransaction(work) {
        return work({});
      }
    },
    userSettingsRepository: {
      async ensureForUserId(userId) {
        return { userId };
      }
    },
    resolveLifecycleContributors: () => [{
      contributorId: "workspaces.provisioning",
      async afterIdentityProfileSynced({ profile, created }) {
        if (created) provisioned.push(profile.email);
      }
    }]
  });
  return { profileProjector, profiles, provisioned };
}

async function googleSetup(t, { account, profileProjector = null } = {}) {
  const issuer = await startOidcProvider({ account });
  t.after(() => issuer.close());
  const backend = await fileBackend();
  const service = createService({ backend, profileProjector, oauthProviders: [oidcProviderEntry(issuer)] });
  return { issuer, backend, service };
}

// Re-signs the provider's ID token with changed claims, as a hostile token
// endpoint would; `key` signs it with a key the provider never published.
function tamperIdToken(t, issuer, change, { key = null } = {}) {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const response = await realFetch(url, options);
    if (!String(url).endsWith("/token")) return response;
    const body = await response.json();
    const claims = { ...decodeJwt(body.id_token), ...change };
    body.id_token = key
      ? await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(key)
      : await issuer.sign(claims);
    return Response.json(body, { status: response.status });
  });
}

test("a first Google sign-in creates the user like register, provisions it, and keeps no provider tokens", async (t) => {
  const usersSync = createUsersProfileSync();
  const { issuer, backend, service: baseService } = await googleSetup(t, { profileProjector: usersSync.profileProjector });
  const registered = [];
  const service = createLocalAuthRegisterHookDecorator({
    hook: { blocking: true, handle: (payload) => registered.push(payload.actor.email) }
  }).decorateAuthService(baseService);

  assert.deepEqual(service.getCapabilities().features.oauthLogin.providers, [{ id: "google", label: "Google" }]);
  const { started, input, request } = await approveAtProvider(service);
  assert.equal(new URL(started.url).searchParams.get("code_challenge_method"), "S256");
  assert.ok(new URL(started.url).searchParams.get("nonce"));
  assert.equal(new URL(started.url).searchParams.get("redirect_uri"), `${APP_URL}/auth/login`);

  const result = await service.oauthComplete(input, request);
  assert.equal(result.actor.email, issuer.account.email);
  assert.equal(result.actor.displayName, issuer.account.name);
  assert.equal(result.provider, "google");
  assert.equal(result.returnTo, "/home");
  assert.equal(result.session.purpose, "normal");
  assert.deepEqual(usersSync.provisioned, [issuer.account.email]);
  assert.deepEqual(registered, [issuer.account.email]);

  // An ordinary local session signs the person in; the account has no password.
  const authenticated = await service.authenticateRequest({ cookies: sessionCookies(result.session) });
  assert.equal(authenticated.authenticated, true);
  assert.equal(authenticated.actor.appUserId, "1");
  await assert.rejects(service.login({ email: issuer.account.email, password: "anything at all" }),
    { code: "auth.login.invalidCredentials" });

  const stored = await fs.readFile(path.join(backend.storeDir, "identities.passwd"), "utf8");
  assert.equal(stored.trim().split("\n").length, 1);
  const attempts = await fs.readFile(path.join(backend.storeDir, "oauth-attempts.passwd"), "utf8");
  assert.equal(attempts, "", "a completed attempt is deleted");
  for (const file of await fs.readdir(backend.storeDir)) {
    const content = await fs.readFile(path.join(backend.storeDir, file), "utf8").catch(() => "");
    assert.doesNotMatch(content, /eyJ/u, `${file} holds no provider token`);
  }

  // A second sign-in finds the same user and provisions nothing new.
  const again = await approveAtProvider(service);
  const second = await service.oauthComplete(again.input, again.request);
  assert.equal(second.actor.providerUserId, result.actor.providerUserId);
  assert.deepEqual(usersSync.provisioned, [issuer.account.email]);
  assert.deepEqual(registered, [issuer.account.email]);
});

test("a verified email that matches an existing account signs it in and links Google; later sign-ins match the subject", async (t) => {
  const { issuer, service } = await googleSetup(t);
  const existing = await service.register({ email: issuer.account.email, password: "correct horse battery" });

  const first = await approveAtProvider(service);
  const linked = await service.oauthComplete(first.input, first.request);
  assert.equal(linked.actor.providerUserId, existing.actor.providerUserId);
  assert.equal(linked.registered, false);

  // The provider now reports another address: the subject still finds the account.
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const response = await realFetch(url, options);
    if (!String(url).endsWith("/me")) return response;
    const body = await response.json();
    return Response.json({ ...body, email: "renamed@example.test" }, { status: response.status });
  });
  const later = await approveAtProvider(service);
  const again = await service.oauthComplete(later.input, later.request);
  assert.equal(again.actor.providerUserId, existing.actor.providerUserId);
  assert.equal(again.actor.email, issuer.account.email);
});

test("a callback with the wrong state, another browser's attempt, or a used attempt is refused", async (t) => {
  const { backend, service } = await googleSetup(t);
  const { input, request } = await approveAtProvider(service);
  await assert.rejects(service.oauthComplete({ ...input, state: "not-the-state" }, request), EXPIRED);
  // The refused try consumed the attempt: the right state can no longer use it.
  await assert.rejects(service.oauthComplete(input, request), EXPIRED);

  const next = await approveAtProvider(service);
  await assert.rejects(service.oauthComplete(next.input, { cookies: {} }), EXPIRED, "no attempt cookie in this browser");
  const other = await service.oauthStart({ provider: "google" });
  await assert.rejects(service.oauthComplete(next.input, { cookies: { [ATTEMPT_COOKIE]: other.attempt } }), EXPIRED);

  const stale = await approveAtProvider(service);
  await backend.withTransaction(async (tx) => {
    const attempt = await tx.oauthAttempts.take(sha256Base64url(stale.started.attempt));
    await tx.oauthAttempts.create({ ...attempt, expiresAt: new Date(Date.now() - 1000).toISOString() });
  });
  await assert.rejects(service.oauthComplete(stale.input, stale.request), EXPIRED, "an attempt older than ten minutes");
});

test("an ID token with the wrong nonce, audience or issuer, or signed by another key, is refused", async (t) => {
  const { privateKey: foreignKey } = await generateKeyPair("RS256");
  const cases = [
    ["nonce", { nonce: "another-nonce" }],
    ["audience", { aud: "another-app" }],
    ["issuer", { iss: "https://attacker.example" }],
    ["expiry", { exp: Math.floor(Date.now() / 1000) - 600 }]
  ];
  for (const [reason, change] of cases) {
    await t.test(reason, async (st) => {
      const { issuer, backend, service } = await googleSetup(st);
      tamperIdToken(st, issuer, change);
      const { input, request } = await approveAtProvider(service);
      await assert.rejects(service.oauthComplete(input, request), UNVERIFIED);
      assert.equal(await backend.withTransaction((tx) => tx.users.findByEmail(issuer.account.email)), null);
    });
  }
  await t.test("signature", async (st) => {
    const { issuer, backend, service } = await googleSetup(st);
    tamperIdToken(st, issuer, {}, { key: foreignKey });
    const { input, request } = await approveAtProvider(service);
    await assert.rejects(service.oauthComplete(input, request), UNVERIFIED);
    assert.equal(await backend.withTransaction((tx) => tx.users.findByEmail(issuer.account.email)), null);
  });
});

test("an email Google has not verified never reaches an account", async (t) => {
  const { backend, service } = await googleSetup(t, {
    account: { sub: "usr_test_eve", email: "eve@example.test", name: "Eve", emailVerified: false }
  });
  const { input, request } = await approveAtProvider(service);
  await assert.rejects(service.oauthComplete(input, request), {
    statusCode: 401,
    code: "auth.local.oauth.emailUnverified",
    message: "Google has not confirmed your email address, so this account can't sign in here."
  });
  assert.equal(await backend.withTransaction((tx) => tx.users.findByEmail("eve@example.test")), null);
});

test("Microsoft accepts personal accounts and work accounts on a verified domain only", async (t) => {
  const cases = [
    ["personal account", { tid: MICROSOFT_CONSUMER_TENANT_ID, email: "ada@outlook.example" }, true],
    ["work account, verified domain", { tid: "11111111-2222-3333-4444-555555555555", xms_edov: true, email: "ada@contoso.example" }, true],
    ["work account, unverified domain", { tid: "11111111-2222-3333-4444-555555555555", xms_edov: false, email: "ceo@victim.example" }, "auth.local.oauth.emailUnverified"],
    ["work account, no domain claim", { tid: "11111111-2222-3333-4444-555555555555", email: "ceo@victim.example" }, "auth.local.oauth.emailUnverified"],
    ["no email claim", { tid: MICROSOFT_CONSUMER_TENANT_ID, email: undefined }, "auth.local.oauth.emailMissing"]
  ];
  for (const [reason, claims, outcome] of cases) {
    await t.test(reason, async (st) => {
      const issuer = await startOidcProvider();
      st.after(() => issuer.close());
      const service = createService({
        backend: await fileBackend(),
        oauthProviders: [oidcProviderEntry(issuer, { id: "microsoft", label: "Microsoft" })]
      });
      tamperIdToken(st, issuer, claims);
      const { input, request } = await approveAtProvider(service, { provider: "microsoft" });
      if (outcome === true) {
        const result = await service.oauthComplete(input, request);
        assert.equal(result.actor.email, claims.email);
        return;
      }
      await assert.rejects(service.oauthComplete(input, request), { statusCode: 401, code: outcome });
    });
  }
});

test("GitHub signs in with the primary verified address and refuses an unverified one", async (t) => {
  const github = await startFakeGitHub();
  t.after(() => github.close());
  const backend = await fileBackend();
  const service = createService({ backend, oauthProviders: [github.provider] });

  const { started, input, request } = await approveAtProvider(service, { provider: "github" });
  assert.equal(new URL(started.url).searchParams.get("scope"), "read:user user:email");
  assert.equal(new URL(started.url).searchParams.get("nonce"), null);
  const result = await service.oauthComplete(input, request);
  assert.equal(result.actor.email, "ada@example.test");
  assert.equal(result.actor.displayName, "Ada Lovelace");

  github.state.user = { id: 5151, login: "mallory" };
  github.state.emails = [
    { email: "ada@example.test", primary: false, verified: true },
    { email: "mallory@example.test", primary: true, verified: false }
  ];
  const unverified = await approveAtProvider(service, { provider: "github" });
  await assert.rejects(service.oauthComplete(unverified.input, unverified.request), {
    statusCode: 401,
    code: "auth.local.oauth.emailUnverified"
  });
  assert.equal(await backend.withTransaction((tx) => tx.users.findByEmail("mallory@example.test")), null);
});

test("account settings link and unlink providers, never removing the last sign-in method", async (t) => {
  const issuer = await startOidcProvider();
  const github = await startFakeGitHub({ emails: [{ email: "gh-ada@example.test", primary: true, verified: true }] });
  t.after(async () => {
    await issuer.close();
    await github.close();
  });
  const service = createService({
    backend: await fileBackend(),
    oauthProviders: [oidcProviderEntry(issuer), github.provider]
  });
  const methods = async (cookies) => Object.fromEntries((await service.getSecurityStatus({ cookies })).authMethods
    .map((method) => [method.id, { enabled: method.enabled, canEnable: method.canEnable ?? false, canDisable: method.canDisable }]));

  // Signed up through Google: no password, so Google is the only sign-in method.
  const signUp = await approveAtProvider(service);
  const cookies = sessionCookies((await service.oauthComplete(signUp.input, signUp.request)).session);
  assert.deepEqual(await methods(cookies), {
    password: { enabled: false, canEnable: false, canDisable: false },
    "oauth:google": { enabled: true, canEnable: false, canDisable: false },
    "oauth:github": { enabled: false, canEnable: true, canDisable: false }
  });
  await assert.rejects(service.unlinkProvider({ cookies }, { provider: "google" }), {
    statusCode: 409,
    code: "auth.local.oauth.lastMethod"
  });

  // Linking GitHub, whose address differs, returns to settings without a new session.
  const link = await approveAtProvider(service, { provider: "github", cookies, link: true, returnTo: "/account?section=sign-in-methods" });
  const linked = await service.oauthComplete(link.input, link.request);
  assert.equal(linked.session, null);
  assert.equal(linked.returnTo, "/account?section=sign-in-methods");
  assert.equal(linked.actor.email, issuer.account.email);
  assert.deepEqual((await methods(cookies))["oauth:github"], { enabled: true, canEnable: false, canDisable: true });

  const unlinked = await service.unlinkProvider({ cookies }, { provider: "google" });
  assert.equal(unlinked.securityStatus.authMethods.find((method) => method.id === "oauth:google").enabled, false);
  await assert.rejects(service.unlinkProvider({ cookies }, { provider: "github" }), { code: "auth.local.oauth.lastMethod" });
  await assert.rejects(service.unlinkProvider({ cookies }, { provider: "google" }), { statusCode: 404, code: "auth.local.oauth.notLinked" });

  // Another account cannot link the same GitHub identity.
  const other = await service.register({ email: "grace@example.test", password: "correct horse battery" });
  const otherCookies = sessionCookies(other.session);
  const taken = await approveAtProvider(service, { provider: "github", cookies: otherCookies, link: true });
  await assert.rejects(service.oauthComplete(taken.input, taken.request), {
    statusCode: 409,
    code: "auth.local.oauth.identityTaken",
    message: "This GitHub account is already linked to another account."
  });

  // A link started by one account completes only in that account's session.
  const hijack = await approveAtProvider(service, { cookies: otherCookies, link: true });
  await assert.rejects(service.oauthComplete(hijack.input, { cookies: { ...cookies, [ATTEMPT_COOKIE]: hijack.started.attempt } }), {
    code: "auth.session.required"
  });
});

test("returnTo stays on the app's own origin", async (t) => {
  const { service } = await googleSetup(t);
  assert.equal((await service.oauthStart({ provider: "google", returnTo: "https://attacker.example/steal" })).returnTo, "/");
  assert.equal((await service.oauthStart({ provider: "google", returnTo: "//attacker.example" })).returnTo, "/");
  assert.equal((await service.oauthStart({ provider: "google", returnTo: `${APP_URL}/inbox` })).returnTo, `${APP_URL}/inbox`);
  await assert.rejects(service.oauthStart({ provider: "facebook" }), { statusCode: 400, code: "auth.local.oauth.providerInvalid" });
});

test("a provider appears only when its client id and secret are both set", () => {
  const base = { NODE_ENV: "test", AUTH_LOCAL_SESSION_SECRET: "secret", APP_PUBLIC_URL: APP_URL };
  const config = (env) => resolveConfig({ appRoot: os.tmpdir(), backend: {}, env: { ...base, ...env }, logger: null });

  assert.deepEqual(config({}).oauthProviders, []);
  assert.deepEqual(config({
    AUTH_GITHUB_CLIENT_ID: "gh-id",
    AUTH_GITHUB_CLIENT_SECRET: "gh-secret",
    AUTH_GOOGLE_CLIENT_ID: "g-id",
    AUTH_GOOGLE_CLIENT_SECRET: "g-secret"
  }).oauthProviders.map(({ id, clientId }) => [id, clientId]), [["google", "g-id"], ["github", "gh-id"]]);
  assert.equal(config({ AUTH_MICROSOFT_CLIENT_ID: "m-id", AUTH_MICROSOFT_CLIENT_SECRET: "m-secret" }).oauthProviders[0].issuer,
    "https://login.microsoftonline.com/common/v2.0");
  assert.throws(() => config({ AUTH_GOOGLE_CLIENT_ID: "g-id" }),
    /AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET must be set together/u);
  assert.throws(() => config({ APP_PUBLIC_URL: "", AUTH_GITHUB_CLIENT_ID: "id", AUTH_GITHUB_CLIENT_SECRET: "secret" }),
    /APP_PUBLIC_URL is required when local auth OAuth sign-in is configured/u);
});
