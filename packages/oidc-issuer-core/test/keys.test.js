import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createAccount, createBrowser, redeemCode, registerApp, signInThroughHub, verifyIdToken } from "./support/browser.js";
import { createSigningKeyStore } from "../src/server/signingKeys.js";
import { OWNER_EMAIL, createDatabase, startHub } from "./support/hub.js";

const PASSWORD = "correct horse battery staple";
let hub;
let client;
let clock = Date.now();

async function idToken() {
  const { callbackUrl, pkce } = await signInThroughHub(createBrowser(), hub.url, client, { email: OWNER_EMAIL, password: PASSWORD });
  return (await redeemCode(hub.url, client, callbackUrl, pkce)).body.id_token;
}

before(async () => {
  hub = await startHub({ now: () => new Date(clock) });
  client = (await registerApp(hub.url)).body;
  const owner = createBrowser();
  await createAccount(owner, hub.url, { email: OWNER_EMAIL, password: PASSWORD });
  const token = new URL(hub.mailer.lastLink()).searchParams.get("token");
  await owner.api(`${hub.url}/hub/api/email/confirm`, { body: { token } });
  hub.owner = owner;
});

after(async () => {
  await hub?.stop();
});

test("the signing key is created once and stored encrypted", async () => {
  const rows = await hub.knex("oidc_issuer_signing_keys");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "active");
  assert.ok(!rows[0].private_jwk_encrypted.includes("\"d\""), "the private key is not stored in clear");
});

test("16. an old token verifies while its key is retiring and fails after retirement", async () => {
  const oldToken = await idToken();
  const oldKid = JSON.parse(Buffer.from(oldToken.split(".")[0], "base64url")).kid;

  const rotated = await hub.owner.api(`${hub.url}/hub/api/admin/keys/rotate`, { body: {} });
  assert.equal(rotated.status, 200);
  const { kid: newKid } = await rotated.json();
  assert.notEqual(newKid, oldKid);

  const newToken = await idToken();
  assert.equal(JSON.parse(Buffer.from(newToken.split(".")[0], "base64url")).kid, newKid, "the new key signs");
  await verifyIdToken(hub.url, client, oldToken);

  clock += 2 * 3600 * 1000 + 1000;
  await hub.issuer.maintain();
  const jwks = await (await fetch(`${hub.url}/oidc/jwks`)).json();
  assert.deepEqual(jwks.keys.map((key) => key.kid), [newKid]);
  await assert.rejects(() => verifyIdToken(hub.url, client, oldToken));
});

test("only the owner can rotate the signing key", async () => {
  const someone = createBrowser();
  await createAccount(someone, hub.url, { email: "ada@example.test", password: PASSWORD });
  assert.equal((await someone.api(`${hub.url}/hub/api/admin/keys/rotate`, { body: {} })).status, 403);
});

test("a hub started with a different secret stops with a sentence naming OIDC_HUB_SECRET", async () => {
  const database = await createDatabase();
  try {
    await createSigningKeyStore(database, { secret: "the-first-hub-secret-0123456789abcdef0123" }).ensureActiveKey();
    await assert.rejects(
      createSigningKeyStore(database, { secret: "a-different-hub-secret-0123456789abcdef01" }).jwks(),
      (error) => error.name === "HubConfigError" && /OIDC_HUB_SECRET/u.test(error.message)
    );
  } finally {
    await database.destroy();
  }
});
