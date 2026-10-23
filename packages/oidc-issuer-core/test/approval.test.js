import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAccount, createBrowser, interactionUid, authorizationUrl, registerApp, signInThroughHub } from "./support/browser.js";
import { OWNER_EMAIL, startHub } from "./support/hub.js";

const PASSWORD = "correct horse battery staple";
let hub;
let owner;

async function confirmLatestEmail(browser) {
  const token = new URL(hub.mailer.lastLink()).searchParams.get("token");
  const response = await browser.api(`${hub.url}/hub/api/email/confirm`, { body: { token } });
  assert.equal(response.status, 200);
}

before(async () => {
  hub = await startHub({ env: { OIDC_HUB_DEV_ORIGIN_PATTERNS: "https://v64preview-*--acme.vibe64.dev" } });
  owner = createBrowser();
  await createAccount(owner, hub.url, { email: OWNER_EMAIL, password: PASSWORD });
  await confirmLatestEmail(owner);
  await createAccount(createBrowser(), hub.url, { email: "ada@example.test", password: PASSWORD });
});

after(async () => {
  await hub?.stop();
});

async function statusOf(clientId) {
  return (await hub.knex("oidc_issuer_clients").where({ client_id: clientId }).first())?.status;
}

test("13. loopback and development-pattern origins are approved automatically", async () => {
  const loopback = await registerApp(hub.url, { origin: "http://localhost:5173" });
  assert.equal(loopback.response.headers.get("x-hub-client-status"), "active-dev");
  assert.equal(await statusOf(loopback.body.client_id), "active-dev");
  const preview = await registerApp(hub.url, { origin: "https://v64preview-ab12cd34ef56--acme.vibe64.dev" });
  assert.equal(await statusOf(preview.body.client_id), "active-dev");
  const otherTeam = await registerApp(hub.url, { origin: "https://v64preview-ab12cd34ef56--other.vibe64.dev" });
  assert.equal(await statusOf(otherTeam.body.client_id), "pending");
  const nested = await registerApp(hub.url, { origin: "https://x.v64preview-a--acme.vibe64.dev" });
  assert.equal(await statusOf(nested.body.client_id), "pending", "* never spans a dot");
});

test("5 and 13. a production address waits on the approval page until the owner approves it", async () => {
  const { body: client } = await registerApp(hub.url, { origin: "https://shop.example.test", name: "Shop" });
  assert.equal(await statusOf(client.client_id), "pending");

  const person = createBrowser();
  await person.api(`${hub.url}/hub/api/sign-in`, { body: { email: "ada@example.test", password: PASSWORD } });
  const { url } = authorizationUrl(hub.url, client);
  const atHub = await person.follow(url, (current) => current.includes("/auth/sign-in?interaction="));
  const uid = interactionUid(atHub.url);
  const details = await (await person.request(`${hub.url}/hub/interaction/${uid}/details`)).json();
  assert.deepEqual(details.app, { name: "Shop", origin: "https://shop.example.test", status: "pending" });
  const refused = await person.api(`${hub.url}/hub/interaction/${uid}/continue`, { body: {} });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).message, "This app is waiting for approval by the hub's owner.");

  const notOwner = await person.api(`${hub.url}/hub/api/admin/apps/${client.client_id}/approve`, { body: {} });
  assert.equal(notOwner.status, 403);
  const listed = await (await owner.request(`${hub.url}/hub/api/admin/apps`)).json();
  assert.ok(listed.waiting.some((app) => app.clientId === client.client_id && app.origin === "https://shop.example.test"));
  const approved = await owner.api(`${hub.url}/hub/api/admin/apps/${client.client_id}/approve`, { body: {} });
  assert.equal(approved.status, 200);
  assert.equal(await statusOf(client.client_id), "active");

  const signedIn = await signInThroughHub(createBrowser(), hub.url, client, { email: "ada@example.test", password: PASSWORD });
  assert.ok(signedIn.callbackUrl?.startsWith("https://shop.example.test/auth/callback?code="));
});

test("13. a blocked origin cannot register again; Remove lets it register as new", async () => {
  const { body: client } = await registerApp(hub.url, { origin: "https://spam.example.test" });
  const blocked = await owner.api(`${hub.url}/hub/api/admin/apps/${client.client_id}/block`, { body: {} });
  assert.equal(blocked.status, 200);
  const again = await registerApp(hub.url, { origin: "https://spam.example.test" });
  assert.equal(again.response.status, 403);
  assert.equal(again.body.error, "invalid_redirect_uri");
  assert.equal(again.body.error_description, "This address is blocked by the hub's owner.");
  const { url } = authorizationUrl(hub.url, client);
  assert.equal((await fetch(url, { redirect: "manual" })).status, 400, "the blocked app can no longer start a sign-in");
  await owner.api(`${hub.url}/hub/api/admin/apps/${client.client_id}/remove`, { body: {} });
  assert.equal((await registerApp(hub.url, { origin: "https://spam.example.test" })).response.status, 201);
});

test("a new registration from an approved address is approved too", async () => {
  const { body: client } = await registerApp(hub.url, { origin: "https://shop.example.test", name: "Shop" });
  assert.equal(await statusOf(client.client_id), "active");
});

test("idle development registrations are removed after 30 days", async () => {
  const { body: client } = await registerApp(hub.url, { origin: "http://localhost:6000" });
  await hub.knex("oidc_issuer_clients").where({ client_id: client.client_id }).update({ created_at: new Date(Date.now() - 31 * 86400 * 1000) });
  await hub.issuer.maintain();
  assert.equal(await statusOf(client.client_id), undefined);
});
