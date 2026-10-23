import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { hashPassword as localHashPassword } from "@jskit-ai/auth-provider-local-core/server/lib/index";
import { describeImport, importAccounts } from "../src/server/importAccounts.js";
import {
  confirmLatestEmail,
  createAccount,
  createBrowser,
  redeemCode,
  registerApp,
  signInThroughHub,
  verifyIdToken
} from "./support/browser.js";
import { startHub } from "./support/hub.js";

let hub;
let exported;

/** The JSON Lines a JSKIT app's local accounts export produces. */
async function localAccount(id, email, password, displayName) {
  const record = await localHashPassword(password);
  return JSON.stringify({
    id,
    email,
    display_name: displayName,
    password_algorithm: record.algorithm,
    password_version: record.version,
    password_salt: record.salt,
    password_hash: record.hash,
    disabled: false
  });
}

before(async () => {
  hub = await startHub();
  await createAccount(createBrowser(), hub.url, { email: "taken@example.test", password: "someone else entirely" });
  exported = [
    await localAccount("usr_localAda000000000000", "ada@example.test", "ada's old passphrase", "Ada"),
    await localAccount("usr_localGrace0000000000", "grace@example.test", "grace's old passphrase", "Grace"),
    await localAccount("usr_localClash0000000000", "taken@example.test", "clashing passphrase", "Clash")
  ].join("\n");
});

after(async () => {
  await hub?.stop();
});

test("a dry run changes nothing and prints counts only", async () => {
  const result = await importAccounts({ knex: hub.knex, text: exported });
  assert.equal(
    describeImport(result, { apply: false }).split("\n")[0],
    "Would import 2 accounts, skip 0 already present, refuse 1 conflicts."
  );
  assert.equal(await hub.knex("oidc_issuer_accounts").where({ email: "ada@example.test" }).first(), undefined);
  assert.doesNotMatch(describeImport(result, { apply: false }), /passphrase|password_hash/u);
});

test("19. an imported account signs in with its original password and keeps its id as sub", async () => {
  const applied = await importAccounts({ knex: hub.knex, text: exported, apply: true });
  assert.deepEqual([applied.imported, applied.skipped, applied.conflicts.length], [2, 0, 1]);
  const row = await hub.knex("oidc_issuer_accounts").where({ id: "usr_localAda000000000000" }).first();
  assert.equal(Boolean(row.email_verified), false);

  const client = (await registerApp(hub.url)).body;
  const credentials = { email: "ada@example.test", password: "ada's old passphrase" };
  const browser = createBrowser();
  const waiting = await signInThroughHub(browser, hub.url, client, credentials);
  assert.equal(waiting.error, "email_unconfirmed", "an imported email is confirmed once before reaching apps");
  await browser.api(`${hub.url}/hub/api/email/resend`, { body: {} });
  assert.equal((await confirmLatestEmail(hub)).status, 200);

  const { callbackUrl, pkce } = await signInThroughHub(browser, hub.url, client, credentials);
  const { body } = await redeemCode(hub.url, client, callbackUrl, pkce);
  const { payload } = await verifyIdToken(hub.url, client, body.id_token);
  assert.equal(payload.sub, "usr_localAda000000000000");
  assert.equal(payload.email_verified, true);
});

test("running the import again skips what is already there", async () => {
  const again = await importAccounts({ knex: hub.knex, text: exported, apply: true });
  assert.deepEqual([again.imported, again.skipped, again.conflicts.length], [0, 2, 1]);
  assert.match(again.conflicts[0].reason, /email belongs to a different hub account/u);
});
