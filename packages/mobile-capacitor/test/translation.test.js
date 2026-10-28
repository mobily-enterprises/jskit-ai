import assert from "node:assert/strict";
import test from "node:test";
import { createI18n } from "vue-i18n";
import { setJskitI18n, useJskitText } from "@jskit-ai/kernel/client/i18n";
import { resolveCapacitorLaunchUrl } from "../src/client/runtime/oauthLaunchClient.js";
import { resolveCapacitorAbsoluteHttpUrl } from "../src/client/runtime/apiRequestClient.js";

function thrownBy(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  assert.fail("expected an error");
}

test("Capacitor URL errors keep their English and carry a messageCode for the user's language", () => {
  const error = thrownBy(() => resolveCapacitorLaunchUrl("/api/oauth/google/start", ""));
  assert.equal(error.message, "config.mobile.apiBaseUrl is required to launch OAuth from the Capacitor shell.");
  assert.equal(error.messageCode, "mobile.oauth.apiBaseUrlRequired");

  setJskitI18n(createI18n({
    legacy: false,
    locale: "xx",
    messages: { xx: { jskit: { mobile: { oauth: { apiBaseUrlRequired: "[xx] apiBaseUrl manquant." } } } } }
  }));
  try {
    assert.equal(useJskitText().errorMessage(error), "[xx] apiBaseUrl manquant.");
  } finally {
    setJskitI18n(null);
  }
});

test("a caller's own message text is thrown as written", () => {
  const error = thrownBy(() => resolveCapacitorAbsoluteHttpUrl("", "", { emptyUrlMessage: "Pick a URL first." }));
  assert.equal(error.message, "Pick a URL first.");
  assert.equal(error.messageCode, undefined);
});
