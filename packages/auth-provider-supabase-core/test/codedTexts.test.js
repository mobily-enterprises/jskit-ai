import assert from "node:assert/strict";
import test from "node:test";
import { createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { catalogMessage, formatMessage, mergeCatalogs, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import authCoreEnglish from "@jskit-ai/auth-core/locales/en.json" with { type: "json" };
import supabaseEnglish from "../locales/en.json" with { type: "json" };
import {
  mapAuthError,
  mapCurrentPasswordError,
  mapOtpVerifyError,
  mapPasswordUpdateError,
  mapProfileUpdateError,
  mapRecoveryError
} from "../src/server/lib/authErrorMappers.js";
import { mapOAuthCallbackError, normalizeOAuthProviderInput } from "../src/server/lib/authInputParsers.js";
import { requireAuthenticatedProfile } from "../src/server/lib/authenticatedProfile.js";
import { resolveDevAuthProfile } from "../src/server/lib/devAuthBootstrap.js";

const english = mergeCatalogs(authCoreEnglish, supabaseEnglish);

function rendered(code, params = {}) {
  const template = catalogMessage(english, messageKeyForCode(code));
  assert.notEqual(template, undefined, `${code} has no English`);
  return formatMessage(template, params);
}

// A coded error says exactly its catalog English; so does each coded field.
function assertCoded(error, code) {
  assert.equal(error.code, code);
  if (code !== "validation_failed") {
    assert.equal(rendered(error.code, error.params), error.message);
  }
  for (const [field, coded] of Object.entries(error.details?.fieldErrorCodes || {})) {
    assert.equal(rendered(coded.code, coded.params), error.details.fieldErrors[field], field);
  }
  return error;
}

test("Supabase error mappers return coded errors whose English is their message", () => {
  const cases = [
    [mapAuthError({ status: 503, message: "upstream" }), "auth.session.unavailable"],
    [mapAuthError({ status: 429, message: "slow down" }), "auth.supabase.login.rateLimited"],
    [mapAuthError({ message: "User already registered" }), "auth.supabase.register.emailTaken"],
    [mapAuthError({ message: "Email not confirmed" }), "auth.supabase.login.emailUnconfirmed"],
    [mapAuthError({ message: "Invalid login credentials" }), "auth.login.invalidCredentials"],
    [mapAuthError({ message: "Identity is already linked" }), "auth.supabase.link.alreadyLinked"],
    [mapAuthError({ message: "Manual linking is disabled" }), "auth.supabase.link.manualLinkingDisabled"],
    [mapAuthError({ message: "cannot unlink the last identity" }), "auth.supabase.link.lastIdentity"],
    [mapAuthError({ message: "identity not found" }), "auth.supabase.link.notLinked"],
    [mapAuthError({ status: 401, message: "nope" }), "auth.login.invalidCredentials"],
    [mapAuthError({ status: 422, message: "odd" }), "auth.supabase.request.failed"],
    [mapRecoveryError({ status: 429 }), "auth.supabase.recovery.rateLimited"],
    [mapRecoveryError({ status: 400 }), "auth.supabase.recovery.linkInvalid"],
    [mapOtpVerifyError({ status: 400 }), "auth.supabase.otp.invalid"],
    [mapOAuthCallbackError("access_denied"), "auth.supabase.oauth.cancelled"],
    [mapOAuthCallbackError("server_error"), "auth.supabase.oauth.failed"]
  ];
  for (const [error, code] of cases) {
    assertCoded(error, code);
  }
});

test("Supabase field errors carry codes whose English is the field message", async () => {
  const fieldCases = [
    [mapPasswordUpdateError({ message: "New password should be different from the same password" }), "password",
      "auth.supabase.password.sameAsCurrent"],
    [mapPasswordUpdateError({ message: "weak" }), "password", "auth.supabase.password.updateFailed"],
    [mapProfileUpdateError({ status: 400 }), "displayName", "auth.supabase.profile.updateFailed"],
    [mapCurrentPasswordError({ status: 400 }), "currentPassword", "auth.supabase.password.currentIncorrect"],
    [mapCurrentPasswordError({ status: 418 }), "currentPassword", "auth.supabase.password.currentUnverified"]
  ];
  for (const [error, field, code] of fieldCases) {
    assert.equal(assertCoded(error, "validation_failed").details.fieldErrorCodes[field].code, code);
  }

  assert.throws(() => normalizeOAuthProviderInput("github", { providerIds: [] }),
    (error) => assertCoded(error, "validation_failed").details.fieldErrorCodes.provider.code === "auth.supabase.oauth.disabled");
  assert.throws(() => normalizeOAuthProviderInput("gitlab", { providerIds: ["github", "google"] }), (error) => {
    assert.deepEqual(assertCoded(error, "validation_failed").details.fieldErrorCodes.provider, {
      code: "auth.supabase.oauth.providerInvalid",
      params: { providers: "github, google" }
    });
    return true;
  });

  await assert.rejects(() => resolveDevAuthProfile({ email: "ghost@example.com" }, {
    userProfilesRepository: { findById: async () => null, findByEmail: async () => null },
    validationError: createValidationError
  }), (error) => assertCoded(error, "validation_failed").details.fieldErrorCodes.email.code === "auth.dev.userNotFound");
});

test("an invalid authenticated profile names its context through params", () => {
  assert.throws(() => requireAuthenticatedProfile({}, { context: "authentication profile" }),
    (error) => Boolean(assertCoded(error, "auth.supabase.profile.invalid")));
});
