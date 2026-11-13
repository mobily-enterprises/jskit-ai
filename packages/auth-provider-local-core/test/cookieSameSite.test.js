import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { createLocalFileBackend } from "../src/server/lib/index.js";
import { resolveLocalAuthConfig } from "../src/server/lib/config.js";
import { approveAtProvider, createService, oidcProviderEntry, startOidcProvider } from "../test-support/oauthHarness.js";

const PASSWORD = "correct horse battery staple";

/**
 * Every cookie local auth sets and clears in one person's sign-in, password recovery, sign-out and Google sign-in,
 * as [name, "set" or "cleared", path, sameSite].
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} env
 */
async function cookiesOfEveryFlow(t, env) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-same-site-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const issuer = await startOidcProvider();
  t.after(() => issuer.close());
  const service = createService({
    backend: createLocalFileBackend({ storeDir }),
    oauthProviders: [oidcProviderEntry(issuer)],
    profileProjector: noAppProfiles,
    env
  });
  const written = [];
  const reply = {
    setCookie: (name, _value, options) => written.push([name, "set", options.path, options.sameSite]),
    clearCookie: (name, options) => written.push([name, "cleared", options.path, options.sameSite])
  };

  service.writeSessionCookies(reply, (await service.register({ email: "ada@example.com", password: PASSWORD })).session);
  const { recoveryUrl } = await service.requestPasswordReset({ email: "ada@example.com" });
  const recovery = await service.completePasswordRecovery({
    code: new URL(recoveryUrl).searchParams.get("token"),
    type: "recovery"
  });
  service.writeSessionCookies(reply, recovery.session);
  service.clearSessionCookies(reply);

  const { started, input, request } = await approveAtProvider(service);
  service.writeOAuthStartCookies(reply, started);
  const signedIn = await service.oauthComplete(input, request);
  service.clearOAuthStartCookies(reply);
  service.writeSessionCookies(reply, signedIn.session);
  return written;
}

/** What cookiesOfEveryFlow answers when every cookie has the SameSite given. */
function everyCookie(sameSite) {
  const cleared = (pathName) => ["access", "refresh", "recovery"]
    .map((kind) => [`jskit_local_${kind}_token`, "cleared", pathName, sameSite]);
  return [
    ["jskit_local_access_token", "set", "/", sameSite],
    ["jskit_local_refresh_token", "set", "/", sameSite],
    ["jskit_local_recovery_token", "set", "/", sameSite],
    ["jskit_local_refresh_token", "set", "/", sameSite],
    ...cleared("/"),
    ...cleared("/api"),
    ["jskit_local_oauth_attempt", "set", "/", sameSite],
    ["jskit_local_oauth_attempt", "cleared", "/", sameSite],
    ["jskit_local_access_token", "set", "/", sameSite],
    ["jskit_local_refresh_token", "set", "/", sameSite]
  ];
}

test("without AUTH_COOKIE_SAME_SITE every local auth cookie, the OAuth attempt's included, is SameSite=Lax", async (t) => {
  assert.deepEqual(await cookiesOfEveryFlow(t, {}), everyCookie("lax"));
  assert.deepEqual(await cookiesOfEveryFlow(t, { AUTH_COOKIE_SAME_SITE: " " }), everyCookie("lax"));
});

test("AUTH_COOKIE_SAME_SITE=strict makes every local auth cookie and its clearing SameSite=Strict", async (t) => {
  assert.deepEqual(await cookiesOfEveryFlow(t, { AUTH_COOKIE_SAME_SITE: "strict" }), everyCookie("strict"));
});

test("an AUTH_COOKIE_SAME_SITE other than lax or strict stops local auth's startup", () => {
  const resolve = (value) => resolveLocalAuthConfig({
    appRoot: os.tmpdir(),
    env: { NODE_ENV: "test", AUTH_LOCAL_SESSION_SECRET: "test-session-secret", AUTH_COOKIE_SAME_SITE: value },
    fileBackend: false,
    emailRecovery: false
  });
  assert.equal(resolve("Lax").cookieSameSite, "lax");
  assert.equal(resolve(" Strict ").cookieSameSite, "strict");
  for (const value of ["none", "None", "secure", "strict;", "lax strict"]) {
    assert.throws(() => resolve(value), {
      message: `AUTH_COOKIE_SAME_SITE must be lax or strict, not "${value}".`
    });
  }
});
