import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { composeMessage } from "../src/server/mailer.js";
import { authorizationUrl, createAccount, createBrowser, interactionUid, registerApp } from "./support/browser.js";
import { startHub } from "./support/hub.js";

const PASSWORD = "correct horse battery staple";

// An app's Italian translation file, as `jskit i18n export it` would write it.
const ITALIAN = {
  jskit: {
    accounts: {
      mail: {
        footer: "Inviata dal tuo hub degli account su {host}. Se non l'hai chiesta tu, ignorala.",
        confirm: {
          subject: "Conferma la tua email",
          heading: "Conferma la tua email",
          body: "Conferma {email} così le tue app sanno che è davvero tua.",
          action: "Conferma email"
        }
      },
      page: {
        error: {
          title: "Problema di accesso",
          heading: "Questo accesso non può continuare.",
          body: "Torna all'app e riprova."
        },
        signedOut: {
          title: "Disconnesso",
          heading: "Sei disconnesso.",
          body: "Puoi chiudere questa finestra."
        }
      }
    }
  }
};

let english;
let italian;
let appRoot;

before(async () => {
  appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oidc-hub-i18n-"));
  fs.mkdirSync(path.join(appRoot, "src", "locales", "it"), { recursive: true });
  fs.writeFileSync(path.join(appRoot, "src", "locales", "it", "jskit.json"), JSON.stringify(ITALIAN));
  english = await startHub();
  italian = await startHub({ appRoot });
});

after(async () => {
  await english?.stop();
  await italian?.stop();
  if (appRoot) fs.rmSync(appRoot, { recursive: true, force: true });
});

function page(hub, query, headers = {}) {
  return fetch(`${hub.url}/oidc/auth?client_id=unknown-app&${query}`, { headers }).then((response) => response.text());
}

test("without translations the hub's emails, pages and refusals keep their English", async () => {
  const browser = createBrowser();
  await createAccount(browser, english.url, { email: "ada@example.test", password: PASSWORD });
  const email = english.mailer.sent.at(-1);
  const link = english.mailer.lastLink();
  assert.equal(email.subject, "Confirm your email");
  assert.deepEqual({ text: email.text, html: email.html }, composeMessage({
    heading: "Confirm your email",
    body: "Confirm ada@example.test so your apps know it is really yours.",
    actionLabel: "Confirm email",
    actionUrl: link,
    footer: `Sent by your accounts hub at ${new URL(english.url).host}. If you did not ask for this, ignore this email.`
  }));

  const html = await page(english, "ui_locales=it", { "accept-language": "it" });
  assert.match(html, /<html lang="en">/u);
  assert.match(html, /<title>Sign-in problem<\/title>/u);
  assert.match(html, /This sign-in could not continue\./u);

  const refused = await browser.api(`${english.url}/hub/api/sign-in`, { body: { email: "ada@example.test", password: "wrong password here" } });
  assert.deepEqual(await refused.json(), {
    error: "sign_in_failed",
    message: "That email and password don't match.",
    messageCode: "accounts.signIn.noMatch",
    messageParams: {}
  });
});

test("an email follows the Accept-Language of the request that sent it", async () => {
  const browser = createBrowser();
  await createAccount(browser, italian.url, {
    email: "grace@example.test",
    password: PASSWORD,
    headers: { "accept-language": "it-IT,it;q=0.9,en;q=0.5" }
  });
  const email = italian.mailer.sent.at(-1);
  assert.equal(email.subject, "Conferma la tua email");
  assert.match(email.text, /^Conferma la tua email\n\nConferma grace@example\.test così le tue app sanno che è davvero tua\.\n\nConferma email: http/u);
  assert.match(email.text, new RegExp(`Inviata dal tuo hub degli account su ${new URL(italian.url).host}\\.`, "u"));
  assert.match(email.html, /Conferma la tua email/u);

  await createAccount(createBrowser(), italian.url, { email: "alan@example.test", password: PASSWORD, headers: { "accept-language": "fr,en;q=0.8" } });
  assert.equal(italian.mailer.sent.at(-1).subject, "Confirm your email", "a language the app has not translated falls back to English");
});

test("a page follows the app's ui_locales first, then the browser's Accept-Language", async () => {
  const requested = await page(italian, "ui_locales=it", { "accept-language": "fr" });
  assert.match(requested, /<html lang="it">/u);
  assert.match(requested, /<title>Problema di accesso<\/title>/u);
  assert.match(requested, /Questo accesso non può continuare\./u);

  const browserLanguage = await page(italian, "", { "accept-language": "it-CH,it;q=0.9" });
  assert.match(browserLanguage, /<html lang="it">/u);
  assert.match(browserLanguage, /Problema di accesso/u);

  const preferEnglish = await page(italian, "ui_locales=en", { "accept-language": "it" });
  assert.match(preferEnglish, /<html lang="en">/u);
  assert.match(preferEnglish, /Sign-in problem/u);

  const signedOut = await fetch(`${italian.url}/oidc/session/end/success`, { headers: { "accept-language": "it" } }).then((response) => response.text());
  assert.match(signedOut, /<html lang="it">/u);
  assert.match(signedOut, /Sei disconnesso\./u);
});

test("an interaction's details name the language its pages show in, and refusals stay English with their code", async () => {
  const { body: client } = await registerApp(italian.url);
  const { url } = authorizationUrl(italian.url, client);
  const browser = createBrowser();
  const atSignIn = await browser.follow(`${url}&ui_locales=${encodeURIComponent("de it")}`, (current) => current.includes("/auth/sign-in?interaction="));
  const details = await browser.request(`${italian.url}/hub/interaction/${interactionUid(atSignIn.url)}/details`, { headers: { "accept-language": "fr" } });
  assert.equal((await details.json()).locale, "it");

  const refused = await browser.api(`${italian.url}/hub/api/accounts`, {
    body: { email: "not an email", password: PASSWORD },
    headers: { "accept-language": "it" }
  });
  assert.deepEqual(await refused.json(), {
    error: "email_invalid",
    message: "Enter a valid email address.",
    messageCode: "accounts.account.emailInvalid",
    messageParams: {}
  });
});
