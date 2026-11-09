import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAccount, createBrowser } from "./support/browser.js";
import { OWNER_EMAIL, startHub } from "./support/hub.js";

const PASSWORD = "correct horse battery staple";
let hub;
let owner;

before(async () => {
  hub = await startHub({ env: { OIDC_HUB_DEV_ORIGIN_PATTERNS: "https://preview-*--acme.example.dev" } });
  owner = createBrowser();
  await createAccount(owner, hub.url, { email: OWNER_EMAIL, password: PASSWORD });
});

after(async () => {
  await hub?.stop();
});

async function setup() {
  const response = await owner.request(`${hub.url}/hub/api/admin/setup`);
  return { status: response.status, body: await response.json() };
}

test("the owner must confirm their email before the admin pages open", async () => {
  assert.equal((await setup()).status, 403);
  const token = new URL(hub.mailer.lastLink()).searchParams.get("token");
  await owner.api(`${hub.url}/hub/api/email/confirm`, { body: { token } });
  assert.equal((await setup()).status, 200);
});

test("the setup checklist reports each item", async () => {
  const { body } = await setup();
  const states = Object.fromEntries(body.items.map((item) => [item.id, item.state]));
  assert.deepEqual(states, {
    https: "warning",
    domain: "todo",
    secret: "ok",
    "registration-token": "ok",
    owner: "ok",
    email: "todo",
    google: "todo",
    "signing-key": "ok",
    development: "ok"
  });
  assert.equal(body.googleRedirectUri, `${hub.url}/hub/google/callback`);
  assert.deepEqual(body.devOriginPatterns, ["https://preview-*--acme.example.dev"]);
});

test("a test email and the domain confirmation tick their items", async () => {
  assert.equal((await owner.api(`${hub.url}/hub/api/admin/setup/test-email`, { body: {} })).status, 200);
  assert.equal(hub.mailer.sent.at(-1).subject, "Your accounts hub can send email");
  await owner.api(`${hub.url}/hub/api/admin/setup/domain`, { body: { confirmed: true } });
  const states = Object.fromEntries((await setup()).body.items.map((item) => [item.id, item.state]));
  assert.equal(states.email, "ok");
  assert.equal(states.domain, "ok");
});

test("People lists accounts; the owner cannot turn off their own account", async () => {
  const response = await owner.request(`${hub.url}/hub/api/admin/people`);
  const { people } = await response.json();
  const self = people.find((person) => person.isOwner);
  assert.equal(self.email, OWNER_EMAIL);
  const refused = await owner.api(`${hub.url}/hub/api/admin/people/${self.id}/disable`, { body: {} });
  assert.equal(refused.status, 400);
});

test("People reads only the columns it shows, never a password's hash or salt", async () => {
  await hub.issuer.hub.accounts.create({ email: "linked@example.test", displayName: "Linked", googleSub: "google-subject-1" });
  const statements = [];
  const record = ({ sql }) => statements.push(sql);
  hub.knex.on("query", record);
  let people;
  try {
    people = (await (await owner.request(`${hub.url}/hub/api/admin/people`)).json()).people;
  } finally {
    hub.knex.off("query", record);
  }
  const listing = statements.filter((sql) => /oidc_issuer_accounts/u.test(sql) && /order by/iu.test(sql));
  assert.equal(listing.length, 1, statements.join("\n"));
  assert.doesNotMatch(listing[0], /select \*|password_salt|password_algorithm|"password_hash",|`password_hash`,/iu);
  const byEmail = Object.fromEntries(people.map((person) => [person.email, person]));
  assert.deepEqual(
    [byEmail[OWNER_EMAIL].hasPassword, byEmail[OWNER_EMAIL].googleLinked, byEmail["linked@example.test"].hasPassword,
      byEmail["linked@example.test"].googleLinked],
    [true, false, false, true]
  );
});
