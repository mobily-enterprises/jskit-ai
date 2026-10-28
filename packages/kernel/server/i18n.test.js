import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServerI18n } from "./i18n.js";

const english = {
  jskit: {
    mail: {
      subject: "You're invited to {workspace}",
      greeting: "Hello {name}.",
      footer: "Thanks."
    }
  }
};

const appRoots = [];
test.after(() => {
  for (const appRoot of appRoots) fs.rmSync(appRoot, { recursive: true, force: true });
});

function createAppRoot(translations = {}) {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jskit-server-i18n-"));
  appRoots.push(appRoot);
  for (const [code, catalog] of Object.entries(translations)) {
    const directory = path.join(appRoot, "src", "locales", code);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "jskit.json"), typeof catalog === "string" ? catalog : JSON.stringify(catalog));
  }
  return appRoot;
}

test("createServerI18n renders bundled English without app translations", () => {
  const i18n = createServerI18n({ catalogs: [english] });
  assert.equal(i18n.t("it", "jskit.mail.subject", { workspace: "Acme" }), "You're invited to Acme");
  assert.equal(i18n.t("", "jskit.mail.footer"), "Thanks.");
  assert.equal(i18n.t("en", "jskit.mail.missing"), "jskit.mail.missing");
  assert.equal(createServerI18n({ appRoot: createAppRoot(), catalogs: [english] }).t("it", "jskit.mail.footer"), "Thanks.");
});

test("createServerI18n looks up the exact locale, then its language, then English", () => {
  const appRoot = createAppRoot({
    "it-IT": { jskit: { mail: { greeting: "Ciao {name}!" } } },
    it: { jskit: { mail: { greeting: "Salve {name}.", subject: "Sei invitato in {workspace}" } } },
    en: { jskit: { mail: { footer: "Cheers." } } }
  });
  const i18n = createServerI18n({ appRoot, catalogs: [english] });

  assert.equal(i18n.t("it-IT", "jskit.mail.greeting", { name: "Ada" }), "Ciao Ada!");
  assert.equal(i18n.t("it-it", "jskit.mail.greeting", { name: "Ada" }), "Ciao Ada!", "stored locales are lowercase");
  assert.equal(i18n.t("it_IT", "jskit.mail.subject", { workspace: "Acme" }), "Sei invitato in Acme");
  assert.equal(i18n.t("it-CH", "jskit.mail.greeting", { name: "Ada" }), "Salve Ada.");
  assert.equal(i18n.t("it", "jskit.mail.footer"), "Cheers.", "the app's English rewords JSKIT's");
  assert.equal(i18n.t("fr", "jskit.mail.subject", { workspace: "Acme" }), "You're invited to Acme");
});

test("createServerI18n reads an app's translations once per process", () => {
  const appRoot = createAppRoot({ it: { jskit: { mail: { footer: "Grazie." } } } });
  const i18n = createServerI18n({ appRoot, catalogs: [english] });
  assert.equal(i18n.t("it", "jskit.mail.footer"), "Grazie.");

  fs.writeFileSync(path.join(appRoot, "src", "locales", "it", "jskit.json"), JSON.stringify({}));
  assert.equal(createServerI18n({ appRoot, catalogs: [english] }).t("it", "jskit.mail.footer"), "Grazie.");
});

test("createServerI18n reports a translation file that is not JSON", () => {
  const appRoot = createAppRoot({ it: "{ not json" });
  assert.throws(() => createServerI18n({ appRoot, catalogs: [english] }).t("it", "jskit.mail.footer"),
    /Invalid JSKIT translations in .*jskit\.json/u);
});
