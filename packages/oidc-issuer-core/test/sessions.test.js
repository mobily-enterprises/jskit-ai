import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { authorizationUrl, createAccount, createBrowser, registerApp, signInThroughHub } from "./support/browser.js";
import { startHub } from "./support/hub.js";

const PASSWORD = "correct horse battery staple";
const APP_ORIGIN = "http://localhost:4100";
let hub;
let client;

before(async () => {
  hub = await startHub();
  client = (await registerApp(hub.url, { origin: APP_ORIGIN })).body;
});

after(async () => {
  await hub?.stop();
});

async function signedInPerson(email) {
  const browser = createBrowser();
  await createAccount(browser, hub.url, { email, password: PASSWORD });
  const first = await signInThroughHub(browser, hub.url, client, { email, password: PASSWORD });
  assert.ok(first.callbackUrl, "the first sign-in reaches the app");
  return browser;
}

async function nextSignIn(browser, extra = "") {
  const { url } = authorizationUrl(hub.url, client);
  const { url: landed } = await browser.follow(`${url}${extra}`, (current) =>
    current.includes("/auth/sign-in?interaction=") || current.startsWith(APP_ORIGIN));
  return landed;
}

test("an app signs in silently while the person is signed in to the hub", async () => {
  const browser = await signedInPerson("ada@example.test");
  assert.ok((await nextSignIn(browser)).startsWith(`${APP_ORIGIN}/auth/callback?code=`));
});

test("signing out of the hub ends silent sign-in to apps on that browser", async () => {
  const browser = await signedInPerson("grace@example.test");
  await browser.api(`${hub.url}/hub/api/sign-out`, { body: {} });
  assert.match(await nextSignIn(browser), /\/auth\/sign-in\?interaction=/u);
  const silent = new URL(await nextSignIn(browser, "&prompt=none"));
  assert.equal(silent.searchParams.get("error"), "login_required");
});

test("ending a device's session from the Account page ends that device's silent sign-in", async () => {
  const device = await signedInPerson("lin@example.test");
  const other = createBrowser();
  await other.api(`${hub.url}/hub/api/sign-in`, { body: { email: "lin@example.test", password: PASSWORD } });
  const { sessions } = await (await other.request(`${hub.url}/hub/api/account`)).json();
  const deviceSession = sessions.find((item) => !item.current);
  assert.equal((await other.api(`${hub.url}/hub/api/account/sessions/${deviceSession.id}`, { method: "DELETE" })).status, 200);
  assert.match(await nextSignIn(device), /\/auth\/sign-in\?interaction=/u);
});
