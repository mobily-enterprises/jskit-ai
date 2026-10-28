import assert from "node:assert/strict";
import test from "node:test";
import { createI18n } from "vue-i18n";

import { createTextError, registerJskitMessages, setJskitI18n, useJskitText } from "./i18n.js";

const english = {
  jskit: {
    auth: {
      login: { title: "Sign in", invalidCredentials: "Invalid email or password." },
      password: { tooShort: "Use at least {min} characters." }
    },
    errors: { not_found: "Not found." }
  }
};

function reset() {
  delete globalThis.__JSKIT_CLIENT_I18N__;
  registerJskitMessages(english);
}

test("without vue-i18n JSKIT renders its bundled English", () => {
  reset();
  const { t, text, errorMessage, fieldErrorMessages, locale } = useJskitText();

  assert.equal(locale, undefined);
  assert.equal(t("jskit.auth.login.title"), "Sign in");
  assert.equal(t("jskit.auth.password.tooShort", { min: 8 }), "Use at least 8 characters.");
  assert.equal(t("jskit.auth.unknown"), "jskit.auth.unknown");
  assert.equal(text("jskit.auth.login.title"), "Sign in");
  assert.equal(text("Settings"), "Settings");
  assert.equal(text({ key: "jskit.auth.unknown", fallback: "Fallback" }), "Fallback");
  assert.equal(errorMessage({ code: "auth.login.invalidCredentials", message: "Invalid email or password." }),
    "Invalid email or password.");
  assert.deepEqual(fieldErrorMessages({
    details: {
      fieldErrors: { password: "Use at least 8 characters.", email: "Invalid." },
      fieldErrorCodes: { password: { code: "auth.password.tooShort", params: { min: 8 } } }
    }
  }), { password: "Use at least 8 characters.", email: "Invalid." });
});

test("an app's vue-i18n translates JSKIT texts and server codes in the active locale", () => {
  reset();
  const i18n = createI18n({
    legacy: false,
    locale: "it",
    messages: {
      en: { jskit: { auth: { login: { title: "Log in" } } } },
      it: {
        jskit: {
          auth: {
            login: { invalidCredentials: "Email o password non validi." },
            password: { tooShort: "Usa almeno {min} caratteri." }
          },
          errors: { not_found: "Non trovato." }
        }
      }
    }
  });
  setJskitI18n(i18n);
  const { t, errorMessage, fieldErrorMessages, formatNumber } = useJskitText();

  assert.equal(t("jskit.auth.password.tooShort", { min: 8 }), "Usa almeno 8 caratteri.");
  assert.equal(t("jskit.auth.login.title"), "Log in", "missing translations fall back to English, the app's first");
  assert.equal(errorMessage({ code: "auth.login.invalidCredentials", message: "Invalid email or password." }),
    "Email o password non validi.");
  assert.equal(errorMessage({ code: "not_found", message: "Not found." }), "Non trovato.");
  assert.equal(errorMessage({ code: "not_found", message: "Contact not found." }), "Contact not found.",
    "an app's own sentence under a shared code is shown as sent");
  assert.equal(errorMessage({ code: "APP_ERROR", message: "Custom." }), "Custom.");
  assert.deepEqual(fieldErrorMessages({
    fieldErrors: { password: "Use at least 8 characters." },
    fieldErrorCodes: { password: { code: "auth.password.tooShort", params: { min: 8 } } }
  }), { password: "Usa almeno 8 caratteri." });
  assert.equal(formatNumber(12345.5), "12.345,5");

  i18n.global.locale.value = "en";
  assert.equal(t("jskit.auth.password.tooShort", { min: 8 }), "Use at least 8 characters.");
  assert.equal(formatNumber(12345.5), "12,345.5");
});

test("JSKIT rejects a legacy-mode vue-i18n instance", () => {
  reset();
  assert.throws(() => setJskitI18n(createI18n({ legacy: true, locale: "en" })), /legacy: false/u);
});

test("relative times follow the active locale", () => {
  reset();
  const now = Date.parse("2026-10-28T12:00:00Z");
  const { formatRelativeTime } = useJskitText();
  assert.equal(formatRelativeTime("2026-10-28T11:55:00Z", { now }), "5 minutes ago");
  assert.equal(formatRelativeTime("2026-10-29T12:00:00Z", { now }), "tomorrow");
  assert.equal(formatRelativeTime("not a date", { now }), "");
});

test("a label can be rendered in English while another language is active", () => {
  reset();
  setJskitI18n(createI18n({
    legacy: false,
    locale: "it",
    messages: { it: { jskit: { auth: { login: { title: "Accedi" } } } } }
  }));
  const { text } = useJskitText();
  assert.equal(text("jskit.auth.login.title"), "Accedi");
  assert.equal(text("jskit.auth.login.title", { locale: "en" }), "Sign in");
  assert.equal(text({ key: "jskit.auth.login.title" }, { locale: "en" }), "Sign in");
  assert.equal(text("Reports", { locale: "en" }), "Reports");
});

test("createTextError keeps JSKIT's English and a messageCode for the user's language", () => {
  reset();
  const error = createTextError("jskit.auth.password.tooShort", { min: 8 });
  assert.equal(error.message, "Use at least 8 characters.");
  assert.equal(error.messageCode, "auth.password.tooShort");
  assert.deepEqual(error.messageParams, { min: 8 });
  const plain = createTextError("Something an app wrote.");
  assert.equal(plain.message, "Something an app wrote.");
  assert.equal(plain.messageCode, undefined);
});
