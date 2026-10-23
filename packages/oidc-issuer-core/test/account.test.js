import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAccount, createBrowser } from "./support/browser.js";
import { startHub } from "./support/hub.js";

const PASSWORD = "correct horse battery staple";
let hub;

before(async () => {
  hub = await startHub();
});

after(async () => {
  await hub?.stop();
});

async function get(browser, path) {
  const response = await browser.request(`${hub.url}${path}`);
  return { status: response.status, body: await response.json() };
}

test("creating an account signs in and sends one confirmation email", async () => {
  const browser = createBrowser();
  const created = await createAccount(browser, hub.url, { email: "Ada@Example.test", password: PASSWORD, displayName: "Ada Lovelace" });
  assert.equal(created.response.status, 200);
  assert.equal(created.body.account.email, "ada@example.test");
  assert.equal(hub.mailer.sent.at(-1).subject, "Confirm your email");
  const { body } = await get(browser, "/hub/api/session");
  assert.equal(body.account.displayName, "Ada Lovelace");
  assert.equal(body.account.emailVerified, false);

  const token = new URL(hub.mailer.lastLink()).searchParams.get("token");
  assert.equal((await browser.api(`${hub.url}/hub/api/email/confirm`, { body: { token } })).status, 200);
  const reused = await browser.api(`${hub.url}/hub/api/email/confirm`, { body: { token } });
  assert.equal(reused.status, 410, "a link works once");
  assert.equal((await get(browser, "/hub/api/session")).body.account.emailVerified, true);
});

test("the same email cannot have two accounts", async () => {
  const again = await createAccount(createBrowser(), hub.url, { email: "ada@example.test", password: PASSWORD });
  assert.equal(again.response.status, 409);
});

test("profile and password changes, with the current password checked", async () => {
  const browser = createBrowser();
  await browser.api(`${hub.url}/hub/api/sign-in`, { body: { email: "ada@example.test", password: PASSWORD } });
  const renamed = await browser.api(`${hub.url}/hub/api/account`, { method: "PATCH", body: { displayName: "Countess" } });
  assert.equal((await renamed.json()).account.displayName, "Countess");
  const wrong = await browser.api(`${hub.url}/hub/api/account/password`, { body: { currentPassword: "nope nope nope", newPassword: "a newer passphrase" } });
  assert.equal(wrong.status, 400);
  const right = await browser.api(`${hub.url}/hub/api/account/password`, { body: { currentPassword: PASSWORD, newPassword: "a newer passphrase" } });
  assert.equal(right.status, 200);
});

test("sessions are listed, can be ended one by one, or everywhere", async () => {
  const first = createBrowser();
  const second = createBrowser();
  for (const browser of [first, second]) {
    await browser.api(`${hub.url}/hub/api/sign-in`, { body: { email: "ada@example.test", password: "a newer passphrase" } });
  }
  const { body } = await get(first, "/hub/api/account");
  assert.ok(body.sessions.length >= 2);
  assert.equal(body.sessions.filter((session) => session.current).length, 1);
  const other = body.sessions.find((session) => !session.current);
  await first.api(`${hub.url}/hub/api/account/sessions/${other.id}`, { method: "DELETE" });
  assert.equal((await get(first, "/hub/api/account")).body.sessions.some((session) => session.id === other.id), false);

  await first.api(`${hub.url}/hub/api/account/sign-out-everywhere`, { body: {} });
  assert.equal((await get(first, "/hub/api/account")).status, 401);
  assert.equal((await get(second, "/hub/api/session")).body.account, null);
});

test("an expired or unknown interaction explains itself in one sentence", async () => {
  const { status, body } = await get(createBrowser(), "/hub/interaction/unknown-uid/details");
  assert.equal(status, 404);
  assert.equal(body.message, "This sign-in has expired. Go back to the app and try again.");
});
