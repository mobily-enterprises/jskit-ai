import assert from "node:assert/strict";
import test from "node:test";
import { createI18n } from "vue-i18n";
import { setJskitI18n } from "@jskit-ai/kernel/client";
import {
  DATE_FORMAT_OPTIONS,
  NUMBER_FORMAT_OPTIONS,
  THEME_OPTIONS
} from "../src/client/composables/account-settings/accountSettingsRuntimeConstants.js";
import {
  resolveLocaleOptions,
  translateOptions
} from "../src/client/composables/account-settings/accountSettingsPreferenceOptions.js";
import { createUsersBootstrapUserHandler } from "../src/client/bootstrap/user-bootstrap-handler.js";
import { useAccountLocale } from "../src/client/lib/accountLocale.js";

test("preference options keep their English labels without app translations", () => {
  assert.deepEqual(translateOptions(THEME_OPTIONS), [
    { title: "System", value: "system" },
    { title: "Light", value: "light" },
    { title: "Dark", value: "dark" }
  ]);
  assert.deepEqual(translateOptions(DATE_FORMAT_OPTIONS).map((option) => option.title), ["System", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]);
  assert.deepEqual(translateOptions(NUMBER_FORMAT_OPTIONS).map((option) => option.title), ["System", "1,234.56", "1.234,56", "1 234,56"]);
});

test("the language select offers the default list when the app configures no languages", () => {
  assert.deepEqual(resolveLocaleOptions("en-US", {}), [
    { title: "English (US)", value: "en-US" },
    { title: "English (UK)", value: "en-GB" },
    { title: "Italian", value: "it-IT" },
    { title: "Spanish", value: "es-ES" }
  ]);
});

test("the language select offers the app's configured languages as canonical codes", () => {
  const appConfig = {
    languages: [
      { code: "en-us", name: "English" },
      { code: "it", name: "Italiano" },
      { code: "EN-US", name: "Duplicate" },
      { code: "", name: "Missing code" }
    ]
  };
  assert.deepEqual(resolveLocaleOptions("it", appConfig), [
    { title: "English", value: "en-US" },
    { title: "Italiano", value: "it" }
  ]);
});

test("a saved locale missing from the configured languages stays selectable under its language name", () => {
  const options = resolveLocaleOptions("en", { languages: [{ code: "it-IT", name: "Italiano" }] });
  assert.deepEqual(options, [{ title: "Italiano", value: "it-IT" }, { title: "English", value: "en" }]);
});

test("without configured languages the default list stays as it was, whatever is saved", () => {
  assert.equal(resolveLocaleOptions("en", {}).length, 4);
});

test("preference option labels follow the app's vue-i18n locale", () => {
  const i18n = createI18n({
    legacy: false,
    locale: "it",
    messages: {
      it: { jskit: { users: { accountSettings: { preferences: { theme: { dark: "Scuro" } } } } } }
    }
  });
  setJskitI18n(i18n);
  try {
    assert.equal(translateOptions(THEME_OPTIONS).find((option) => option.value === "dark").title, "Scuro");
    // A key the app has not translated falls back to English.
    assert.equal(translateOptions(THEME_OPTIONS).find((option) => option.value === "light").title, "Light");
  } finally {
    setJskitI18n(null);
  }
});

test("useAccountLocale follows the bootstrap payload's saved locale", async () => {
  const handler = createUsersBootstrapUserHandler();
  const accountLocale = useAccountLocale();

  await handler.applyBootstrapPayload({
    payload: { session: { authenticated: true, userId: "7" }, userSettings: { locale: "it-it" } }
  });
  assert.equal(accountLocale.value, "it-IT");

  await handler.handleBootstrapError({ error: { statusCode: 500 } });
  assert.equal(accountLocale.value, "it-IT");

  await handler.handleBootstrapError({ error: { statusCode: 401 } });
  assert.equal(accountLocale.value, "");

  await handler.applyBootstrapPayload({ payload: { session: { authenticated: true }, userSettings: { locale: "en" } } });
  await handler.applyBootstrapPayload({ payload: { session: { authenticated: false }, userSettings: null } });
  assert.equal(accountLocale.value, "");
});
