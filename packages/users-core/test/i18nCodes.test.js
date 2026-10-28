import assert from "node:assert/strict";
import test from "node:test";
import { catalogMessage, formatMessage, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import en from "../locales/en.json" with { type: "json" };
import { createService as createAccountProfileService } from "../src/server/accountProfile/accountProfileService.js";
import { createService as createAccountSecurityService } from "../src/server/accountSecurity/accountSecurityService.js";
import { createRepository as createUserSettingsRepository } from "../src/server/common/repositories/userSettingsRepository.js";
import { userSettingsResource } from "../src/shared/resources/userSettingsResource.js";
import { normalizeLocaleCode } from "../src/shared/settings.js";

// A code's catalog English, rendered with its params, is exactly the English sent.
function catalogEnglish(code, params = {}) {
  return formatMessage(catalogMessage(en, messageKeyForCode(code)), params);
}

function assertCodedError(code) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(catalogEnglish(error.code, error.params), error.message);
    return true;
  };
}

const emptyProfiles = {
  async findByIdentity() { return null; },
  async findById() { return null; }
};

test("account services throw coded errors whose catalog English matches", async () => {
  const profileService = createAccountProfileService({
    userProfilesRepository: emptyProfiles,
    userSettingsRepository: {},
    avatarService: { async readForUser() { return null; } }
  });
  await assert.rejects(() => profileService.getForUser({}, { id: 7 }), assertCodedError("users.profile.notFound"));
  await assert.rejects(() => profileService.readAvatar({}, { id: 7 }), assertCodedError("users.avatar.notFound"));

  const securityService = createAccountSecurityService({ userSettingsRepository: {}, userProfilesRepository: emptyProfiles });
  await assert.rejects(() => securityService.changePassword({}, { id: 7 }), assertCodedError("users.security.passwordChangeUnavailable"));
  await assert.rejects(() => securityService.setPasswordMethodEnabled({}, { id: 7 }), assertCodedError("users.security.passwordMethodToggleUnavailable"));
  await assert.rejects(() => securityService.startOAuthProviderLink({}, { id: 7 }), assertCodedError("users.security.oauthLinkUnavailable"));
  await assert.rejects(() => securityService.unlinkOAuthProvider({}, { id: 7 }), assertCodedError("users.security.oauthUnlinkUnavailable"));
  await assert.rejects(() => securityService.logoutOtherSessions({}, { id: 7 }), assertCodedError("users.security.logoutOtherSessionsUnavailable"));
});

test("password change codes its field error and its success message", async () => {
  const service = createAccountSecurityService({
    userSettingsRepository: {},
    userProfilesRepository: emptyProfiles,
    authService: { async changePassword() { return { session: null }; } }
  });

  await assert.rejects(
    () => service.changePassword({}, { id: 7 }, { newPassword: "new-password", confirmPassword: "other" }),
    (error) => {
      const coded = error.details.fieldErrorCodes.confirmPassword;
      assert.equal(coded.code, "users.security.passwordConfirmationMismatch");
      assert.equal(catalogEnglish(coded.code, coded.params), error.details.fieldErrors.confirmPassword);
      return true;
    }
  );

  const { response } = await service.changePassword({}, { id: 7 }, { newPassword: "new-password", confirmPassword: "new-password" });
  assert.deepEqual(response.value, { message: "Password updated.", messageCode: "users.security.passwordUpdated", messageParams: {} });
  assert.equal(catalogEnglish(response.value.messageCode), response.value.message);
});

test("saved locales are canonical BCP 47 tags", () => {
  assert.equal(normalizeLocaleCode("en-us"), "en-US");
  assert.equal(normalizeLocaleCode(" EN-gb "), "en-GB");
  assert.equal(normalizeLocaleCode("zh-hant-tw"), "zh-Hant-TW");
  assert.equal(normalizeLocaleCode("en"), "en");
  assert.equal(normalizeLocaleCode(""), "");
  // Not a language tag: kept in the lowercased form it was always stored in.
  assert.equal(normalizeLocaleCode("English_US"), "english_us");
});

test("preference input keeps the locale's case and storage canonicalizes it", async () => {
  const parsed = validateOperationSection({
    operation: userSettingsResource.operations.preferencesUpdate,
    section: "body",
    value: {
      theme: "system",
      locale: "en-US",
      timeZone: "UTC",
      dateFormat: "system",
      numberFormat: "system",
      currencyCode: "USD",
      avatarSize: 64
    }
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.locale, "en-US");
  assert.equal(userSettingsResource.schema.locale.setter("it-it"), "it-IT");
});

test("user settings reads canonicalize locales saved lowercased", async () => {
  const repository = createUserSettingsRepository({
    api: {
      resources: {
        userSettings: {
          async query() {
            return { data: [{ id: "7", locale: "en-us", theme: "dark" }] };
          }
        }
      }
    }
  });

  const settings = await repository.findByUserId("7");
  assert.equal(settings.locale, "en-US");
  assert.equal(settings.theme, "dark");
});
