import assert from "node:assert/strict";
import test from "node:test";
import { createI18n } from "vue-i18n";

import {
  catalogMessage,
  flattenCatalog,
  formatMessage,
  mergeCatalogs,
  messageKeyForCode,
  messageParams
} from "./index.js";

test("formatMessage renders named, literal and plural parts like vue-i18n", () => {
  const messages = {
    named: "Welcome back, {name}.",
    literal: "Write to support{'@'}example.com {'|'} {'{'}braces{'}'}",
    twoChoices: "{count} file | {count} files",
    threeChoices: "no files | one file | {count} files",
    missing: "Hello {name}!"
  };
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: messages } });
  const cases = [
    ["named", { name: "Ada" }],
    ["literal", {}],
    ["twoChoices", { count: 1 }],
    ["twoChoices", { count: 3 }],
    ["threeChoices", { count: 0 }],
    ["threeChoices", { count: 1 }],
    ["threeChoices", { count: 7 }],
    ["missing", {}]
  ];
  for (const [key, params] of cases) {
    const plural = params.count === undefined ? {} : { plural: params.count };
    assert.equal(formatMessage(messages[key], params), i18n.global.t(key, params, plural), key);
  }
});

test("messageKeyForCode maps dotted codes to their namespace and older codes to jskit.errors", () => {
  assert.equal(messageKeyForCode("auth.login.invalidCredentials"), "jskit.auth.login.invalidCredentials");
  assert.equal(messageKeyForCode("ACTION_PERMISSION_DENIED"), "jskit.errors.ACTION_PERMISSION_DENIED");
  assert.equal(messageKeyForCode(""), "");
});

test("catalog helpers read, merge and flatten nested catalogs", () => {
  const jskit = { jskit: { auth: { login: { title: "Sign in", submit: "Continue" } } } };
  const app = { jskit: { auth: { login: { title: "Log in" } } } };
  const merged = mergeCatalogs(jskit, app);

  assert.equal(catalogMessage(merged, "jskit.auth.login.title"), "Log in");
  assert.equal(catalogMessage(merged, "jskit.auth.login.submit"), "Continue");
  assert.equal(catalogMessage(merged, "jskit.auth.login"), undefined);
  assert.equal(catalogMessage(merged, "jskit.auth.missing"), undefined);
  assert.deepEqual(flattenCatalog(merged), {
    "jskit.auth.login.title": "Log in",
    "jskit.auth.login.submit": "Continue"
  });
  assert.equal(jskit.jskit.auth.login.title, "Sign in");
});

test("messageParams lists the placeholders a translation must keep", () => {
  assert.deepEqual(messageParams("{count} file of {name} | {count} files of {name}"), ["count", "name"]);
  assert.deepEqual(messageParams("Write to support{'@'}example.com"), []);
});
