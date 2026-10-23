import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createAccount, createBrowser } from "./support/browser.js";
import { startHub } from "./support/hub.js";

const EMAIL = "ada@example.test";
const PASSWORD = "correct horse battery staple";
let hub;
let clock = Date.now();

before(async () => {
  hub = await startHub({ now: () => new Date(clock) });
  await createAccount(createBrowser(), hub.url, { email: EMAIL, password: PASSWORD });
});

beforeEach(() => {
  clock += 2 * 3600 * 1000;
});

after(async () => {
  await hub?.stop();
});

function signIn(browser, password = PASSWORD) {
  return browser.api(`${hub.url}/hub/api/sign-in`, { body: { email: EMAIL, password } });
}

test("14. sign-in is limited to 10 attempts a minute per address", async () => {
  const browser = createBrowser();
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    assert.equal((await signIn(browser, "wrong password here")).status, 401, `attempt ${attempt}`);
  }
  const limited = await signIn(browser);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).message, "Too many attempts. Wait a little and try again.");
  clock += 61 * 1000;
  assert.equal((await signIn(browser)).status, 200);
});

test("14. after 100 consecutive failures the right password is refused until recovery", async () => {
  await hub.knex("oidc_issuer_accounts").where({ email: EMAIL }).update({ failed_logins: 99 });
  const browser = createBrowser();
  assert.equal((await signIn(browser, "wrong password here")).status, 401, "the 100th failure");
  const locked = await signIn(browser);
  assert.equal(locked.status, 401, "the 101st attempt, with the right password");
  assert.deepEqual(await locked.json(), { error: "sign_in_failed", message: "That email and password don't match." });

  await browser.api(`${hub.url}/hub/api/recovery/start`, { body: { email: EMAIL } });
  const token = new URL(hub.mailer.lastLink()).searchParams.get("token");
  const reset = await browser.api(`${hub.url}/hub/api/recovery/finish`, { body: { token, password: "a brand new passphrase" } });
  assert.equal(reset.status, 200);
  clock += 61 * 1000;
  assert.equal((await signIn(createBrowser(), "a brand new passphrase")).status, 200);
});

test("14. a common password is refused at registration and at change", async () => {
  const browser = createBrowser();
  const created = await createAccount(browser, hub.url, { email: "grace@example.test", password: "password123" });
  assert.equal(created.response.status, 400);
  assert.equal(created.body.message, "That password is too common. Choose one that is harder to guess.");
  await createAccount(browser, hub.url, { email: "grace@example.test", password: "an uncommon passphrase" });
  const changed = await browser.api(`${hub.url}/hub/api/account/password`, {
    body: { currentPassword: "an uncommon passphrase", newPassword: "iloveyou1" }
  });
  assert.equal(changed.status, 400);
  assert.equal((await changed.json()).error, "password_rejected");
});

test("14. recovery emails are limited to 5 an hour per address", async () => {
  const browser = createBrowser();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal((await browser.api(`${hub.url}/hub/api/recovery/start`, { body: { email: EMAIL } })).status, 200);
  }
  assert.equal((await browser.api(`${hub.url}/hub/api/recovery/start`, { body: { email: EMAIL } })).status, 429);
});

test("recovery answers the same for an unknown email and sends nothing", async () => {
  const before = hub.mailer.sent.length;
  const response = await createBrowser().api(`${hub.url}/hub/api/recovery/start`, { body: { email: "nobody@example.test" } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(hub.mailer.sent.length, before);
});
