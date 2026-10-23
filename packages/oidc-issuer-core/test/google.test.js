import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAccount, createBrowser } from "./support/browser.js";
import { startHub } from "./support/hub.js";
import { startMockGoogle } from "./support/mockGoogle.js";

const PASSWORD = "correct horse battery staple";
let hub;
let google;

before(async () => {
  google = await startMockGoogle();
  hub = await startHub({
    env: { OIDC_HUB_GOOGLE_CLIENT_ID: "hub-google-client", OIDC_HUB_GOOGLE_CLIENT_SECRET: "hub-google-secret" },
    googleEndpoints: google.endpoints
  });
});

after(async () => {
  await hub?.stop();
  await google?.stop();
});

async function continueWithGoogle(browser, identity) {
  google.nextIdentity = identity;
  const { url } = await browser.follow(`${hub.url}/hub/google/start`, (current) =>
    current.startsWith(hub.url) && !current.includes("/hub/google/"));
  return url;
}

async function session(browser) {
  return (await browser.request(`${hub.url}/hub/api/session`)).json();
}

test("a new Google identity with a verified email creates a verified account", async () => {
  const browser = createBrowser();
  const landed = await continueWithGoogle(browser, { sub: "g-new", email: "new@example.test", emailVerified: true, name: "New Person" });
  assert.equal(new URL(landed).pathname, "/account");
  const { account } = await session(browser);
  assert.equal(account.email, "new@example.test");
  assert.equal(account.emailVerified, true);
  assert.equal(account.googleLinked, true);
  assert.equal(account.hasPassword, false);
});

test("15. a Google email matching an unverified account does not link automatically", async () => {
  await createAccount(createBrowser(), hub.url, { email: "ada@example.test", password: PASSWORD });
  const browser = createBrowser();
  const landed = await continueWithGoogle(browser, { sub: "g-ada", email: "ada@example.test", emailVerified: true });
  assert.equal(new URL(landed).pathname, "/auth/connect-google");
  assert.equal((await session(browser)).account, null, "nobody is signed in yet");
  const row = await hub.knex("oidc_issuer_accounts").where({ email: "ada@example.test" }).first();
  assert.equal(row.google_sub, null);

  const pending = await (await browser.request(`${hub.url}/hub/api/google/link`)).json();
  assert.equal(pending.email, "ada@example.test");
  const wrong = await browser.api(`${hub.url}/hub/api/google/link/password`, { body: { password: "not it at all" } });
  assert.equal(wrong.status, 401);
  const linked = await browser.api(`${hub.url}/hub/api/google/link/password`, { body: { password: PASSWORD } });
  assert.equal(linked.status, 200);
  assert.equal((await session(browser)).account.googleLinked, true);
});

test("15. the emailed link connects Google and replaces the old password", async () => {
  await createAccount(createBrowser(), hub.url, { email: "grace@example.test", password: PASSWORD });
  const browser = createBrowser();
  await continueWithGoogle(browser, { sub: "g-grace", email: "grace@example.test", emailVerified: true });
  assert.equal((await browser.api(`${hub.url}/hub/api/google/link/email`, { body: {} })).status, 200);
  const token = new URL(hub.mailer.lastLink()).searchParams.get("token");
  const finished = await browser.api(`${hub.url}/hub/api/google/link/finish`, { body: { token, password: "a fresh passphrase here" } });
  assert.equal(finished.status, 200);
  const signIn = (password) => createBrowser().api(`${hub.url}/hub/api/sign-in`, { body: { email: "grace@example.test", password } });
  assert.equal((await signIn(PASSWORD)).status, 401, "the old password no longer works");
  assert.equal((await signIn("a fresh passphrase here")).status, 200);
});

test("a verified account and a verified Google email link automatically", async () => {
  const browser = createBrowser();
  await createAccount(browser, hub.url, { email: "lin@example.test", password: PASSWORD });
  const token = new URL(hub.mailer.lastLink()).searchParams.get("token");
  await browser.api(`${hub.url}/hub/api/email/confirm`, { body: { token } });
  const other = createBrowser();
  const landed = await continueWithGoogle(other, { sub: "g-lin", email: "lin@example.test", emailVerified: true });
  assert.equal(new URL(landed).pathname, "/account");
  assert.equal((await session(other)).account.email, "lin@example.test");
});

test("an unverified Google email never creates or links an account", async () => {
  const browser = createBrowser();
  const landed = await continueWithGoogle(browser, { sub: "g-unverified", email: "ghost@example.test", emailVerified: false });
  assert.equal(new URL(landed).searchParams.get("google"), "unverified");
  assert.equal(await hub.knex("oidc_issuer_accounts").where({ email: "ghost@example.test" }).first(), undefined);
});

test("a callback whose state does not match the browser is refused", async () => {
  const browser = createBrowser();
  google.nextIdentity = { sub: "g-x", email: "x@example.test", emailVerified: true };
  const start = await browser.request(`${hub.url}/hub/google/start`);
  const atGoogle = await createBrowser().request(start.headers.get("location"));
  const callback = await createBrowser().request(atGoogle.headers.get("location"));
  assert.equal(new URL(callback.headers.get("location"), hub.url).searchParams.get("google"), "failed");
});
