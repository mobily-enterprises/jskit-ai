import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../lib/errors.js";
import { createUserSettingsService, __testables } from "../services/userSettingsService.js";

function buildSettings(overrides = {}) {
  return {
    userId: 7,
    theme: "system",
    locale: "en-US",
    timeZone: "UTC",
    dateFormat: "system",
    numberFormat: "system",
    currencyCode: "USD",
    defaultMode: "fv",
    defaultTiming: "ordinary",
    defaultPaymentsPerYear: 12,
    defaultHistoryPageSize: 10,
    productUpdates: true,
    accountActivity: true,
    securityAlerts: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("user settings service helper validators cover success and failure branches", () => {
  assert.equal(__testables.isValidLocale("en-US"), true);
  assert.equal(__testables.isValidLocale("bad-@@"), false);
  assert.equal(__testables.isValidTimeZone("UTC"), true);
  assert.equal(__testables.isValidTimeZone("Mars/Phobos"), false);
  assert.equal(__testables.isValidCurrencyCode("USD"), true);
  assert.equal(__testables.isValidCurrencyCode("US"), false);
  assert.equal(__testables.isValidCurrencyCode(""), false);

  const profileInvalid = __testables.parseProfileInput({ displayName: "" });
  assert.equal(profileInvalid.fieldErrors.displayName, "Display name is required.");
  const profileNull = __testables.parseProfileInput({ displayName: null });
  assert.equal(profileNull.fieldErrors.displayName, "Display name is required.");
  const profileTooLong = __testables.parseProfileInput({ displayName: "x".repeat(121) });
  assert.equal(profileTooLong.fieldErrors.displayName, "Display name must be at most 120 characters.");

  const profileValid = __testables.parseProfileInput({ displayName: " Jane " });
  assert.equal(profileValid.displayName, "Jane");

  const preferencesInvalid = __testables.parsePreferencesInput({
    theme: "bad",
    locale: "",
    timeZone: "Bad/Zone",
    dateFormat: "bad",
    numberFormat: "bad",
    currencyCode: "US",
    defaultMode: "bad",
    defaultTiming: "bad",
    defaultPaymentsPerYear: 0,
    defaultHistoryPageSize: 101
  });
  assert.equal(Object.keys(preferencesInvalid.fieldErrors).length, 10);

  const preferencesValid = __testables.parsePreferencesInput({
    theme: "dark",
    locale: "en-GB",
    timeZone: "Europe/London",
    dateFormat: "dmy",
    numberFormat: "dot-comma",
    currencyCode: "EUR",
    defaultMode: "pv",
    defaultTiming: "due",
    defaultPaymentsPerYear: 4,
    defaultHistoryPageSize: 25
  });
  assert.equal(preferencesValid.patch.defaultMode, "pv");

  const preferencesInvalidLocale = __testables.parsePreferencesInput({ locale: "bad-@@" });
  assert.equal(preferencesInvalidLocale.fieldErrors.locale, "Locale must be a valid BCP 47 locale tag.");

  const preferencesMissingTimeZone = __testables.parsePreferencesInput({ timeZone: "" });
  assert.equal(preferencesMissingTimeZone.fieldErrors.timeZone, "Time zone is required.");

  const preferencesUnsupportedCurrency = __testables.parsePreferencesInput({ currencyCode: "ZZZ" });
  assert.equal(preferencesUnsupportedCurrency.fieldErrors.currencyCode, "Currency code is not supported.");

  const originalSupportedValuesOf = Intl.supportedValuesOf;
  try {
    Intl.supportedValuesOf = undefined;
    assert.equal(__testables.isValidCurrencyCode("USD"), true);
    assert.equal(__testables.isValidCurrencyCode("1AA"), false);
  } finally {
    Intl.supportedValuesOf = originalSupportedValuesOf;
  }

  const notificationsInvalid = __testables.parseNotificationsInput({ securityAlerts: false });
  assert.equal(notificationsInvalid.fieldErrors.securityAlerts, "Security alerts must stay enabled.");

  const notificationsInvalidBooleanTypes = __testables.parseNotificationsInput({
    productUpdates: "yes",
    accountActivity: 1
  });
  assert.equal(notificationsInvalidBooleanTypes.fieldErrors.productUpdates, "Product updates setting must be boolean.");
  assert.equal(notificationsInvalidBooleanTypes.fieldErrors.accountActivity, "Account activity setting must be boolean.");

  const notificationsValid = __testables.parseNotificationsInput({ productUpdates: false, accountActivity: true });
  assert.equal(notificationsValid.patch.productUpdates, false);

  const notificationsEmpty = __testables.parseNotificationsInput({});
  assert.equal(notificationsEmpty.fieldErrors.notifications, "At least one notification setting is required.");

  const passwordInvalid = __testables.parseChangePasswordInput({
    currentPassword: "",
    newPassword: "short",
    confirmPassword: "nope"
  });
  assert.ok(passwordInvalid.fieldErrors.currentPassword);
  assert.ok(passwordInvalid.fieldErrors.newPassword);
  assert.ok(passwordInvalid.fieldErrors.confirmPassword);

  const passwordEqual = __testables.parseChangePasswordInput({
    currentPassword: "same-password",
    newPassword: "same-password",
    confirmPassword: "same-password"
  });
  assert.equal(passwordEqual.fieldErrors.newPassword, "New password must be different from current password.");

  const passwordValid = __testables.parseChangePasswordInput({
    currentPassword: "old-password",
    newPassword: "new-password-123",
    confirmPassword: "new-password-123"
  });
  assert.equal(passwordValid.fieldErrors.newPassword, undefined);

  const passwordDefaults = __testables.parseChangePasswordInput();
  assert.equal(passwordDefaults.currentPassword, "");
  assert.equal(passwordDefaults.newPassword, "");
  assert.equal(passwordDefaults.confirmPassword, "");

  const security = __testables.normalizeSecurityStatus(null);
  assert.equal(security.mfa.status, "not_enabled");
  assert.deepEqual(security.mfa.methods, []);
  const securityMissingMfa = __testables.normalizeSecurityStatus({});
  assert.equal(securityMissingMfa.mfa.status, "not_enabled");

  const response = __testables.buildSettingsResponse(
    { displayName: "user", email: "user@example.com" },
    buildSettings(),
    {
      mfa: {
        status: "enabled",
        enrolled: true,
        methods: ["totp"]
      }
    }
  );
  assert.equal(response.security.mfa.status, "enabled");

  const validation = __testables.validationError({ a: "bad" });
  assert.ok(validation instanceof AppError);
  assert.equal(validation.status, 400);
});

test("user settings service orchestrates repositories and auth service", async () => {
  const calls = [];
  const service = createUserSettingsService({
    userSettingsRepository: {
      async ensureForUserId(userId) {
        calls.push(["ensureForUserId", userId]);
        return buildSettings({ userId });
      },
      async updatePreferences(userId, patch) {
        calls.push(["updatePreferences", userId, patch]);
        return buildSettings({ userId, ...patch });
      },
      async updateNotifications(userId, patch) {
        calls.push(["updateNotifications", userId, patch]);
        return buildSettings({ userId, ...patch });
      }
    },
    userProfilesRepository: {
      async updateDisplayNameById(userId, displayName) {
        calls.push(["updateDisplayNameById", userId, displayName]);
        return {
          id: userId,
          supabaseUserId: "supabase-7",
          email: "user@example.com",
          displayName,
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      }
    },
    authService: {
      async getSecurityStatus(request) {
        calls.push(["getSecurityStatus", request.marker]);
        return {
          mfa: {
            status: "not_enabled",
            enrolled: false,
            methods: []
          }
        };
      },
      async updateDisplayName(request, displayName) {
        calls.push(["updateDisplayName", request.marker, displayName]);
        return {
          profile: {
            id: 7,
            supabaseUserId: "supabase-7",
            email: "user@example.com",
            displayName,
            createdAt: "2024-01-01T00:00:00.000Z"
          },
          session: null
        };
      },
      async changePassword(request, payload) {
        calls.push(["changePassword", request.marker, payload]);
        return {
          session: {
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600
          }
        };
      },
      async signOutOtherSessions(request) {
        calls.push(["signOutOtherSessions", request.marker]);
      }
    }
  });

  const user = {
    id: 7,
    supabaseUserId: "supabase-7",
    email: "user@example.com",
    displayName: "user"
  };

  const settings = await service.getForUser({ marker: "get" }, user);
  assert.equal(settings.profile.email, "user@example.com");

  const profileUpdated = await service.updateProfile({ marker: "profile" }, user, { displayName: "new-name" });
  assert.equal(profileUpdated.settings.profile.displayName, "new-name");

  const preferencesUpdated = await service.updatePreferences({ marker: "prefs" }, user, {
    theme: "dark",
    locale: "en-GB",
    timeZone: "Europe/London",
    dateFormat: "dmy",
    numberFormat: "dot-comma",
    currencyCode: "EUR",
    defaultMode: "pv",
    defaultTiming: "due",
    defaultPaymentsPerYear: 4,
    defaultHistoryPageSize: 25
  });
  assert.equal(preferencesUpdated.preferences.theme, "dark");

  const notificationsUpdated = await service.updateNotifications({ marker: "notify" }, user, {
    productUpdates: false,
    accountActivity: false,
    securityAlerts: true
  });
  assert.equal(notificationsUpdated.notifications.accountActivity, false);

  const passwordResult = await service.changePassword(
    { marker: "password" },
    {
      currentPassword: "old-password",
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    }
  );
  assert.equal(passwordResult.ok, true);
  assert.equal(passwordResult.message, "Password changed.");

  const logoutOthers = await service.logoutOtherSessions({ marker: "logout-others" });
  assert.equal(logoutOthers.ok, true);

  assert.ok(calls.length >= 10);
});

test("user settings service falls back when auth service omits profile/session", async () => {
  const service = createUserSettingsService({
    userSettingsRepository: {
      async ensureForUserId(userId) {
        return buildSettings({ userId });
      },
      async updatePreferences() {
        return buildSettings();
      },
      async updateNotifications() {
        return buildSettings();
      }
    },
    userProfilesRepository: {
      async updateDisplayNameById(userId, displayName) {
        return {
          id: userId,
          supabaseUserId: "supabase-fallback",
          email: "fallback@example.com",
          displayName,
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      }
    },
    authService: {
      async getSecurityStatus() {
        return {};
      },
      async updateDisplayName() {
        return {
          profile: null,
          session: null
        };
      },
      async changePassword() {
        return {};
      },
      async signOutOtherSessions() {}
    }
  });

  const user = {
    id: 7,
    supabaseUserId: "supabase-7",
    email: "user@example.com",
    displayName: "user"
  };

  const profileUpdated = await service.updateProfile({ marker: "fallback-profile" }, user, { displayName: "fallback-name" });
  assert.equal(profileUpdated.settings.profile.displayName, "fallback-name");
  assert.equal(profileUpdated.session, null);

  const changedPassword = await service.changePassword(
    { marker: "fallback-password" },
    {
      currentPassword: "old-password",
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    }
  );
  assert.equal(changedPassword.session, null);
});

test("user settings service throws validation errors for invalid payloads", async () => {
  const service = createUserSettingsService({
    userSettingsRepository: {
      async ensureForUserId() {
        return buildSettings();
      },
      async updatePreferences() {
        return buildSettings();
      },
      async updateNotifications() {
        return buildSettings();
      }
    },
    userProfilesRepository: {
      async updateDisplayNameById() {
        return null;
      }
    },
    authService: {
      async getSecurityStatus() {
        return { mfa: { status: "not_enabled", enrolled: false, methods: [] } };
      },
      async updateDisplayName() {
        return { profile: null, session: null };
      },
      async changePassword() {
        return { session: null };
      },
      async signOutOtherSessions() {}
    }
  });

  const user = {
    id: 7,
    supabaseUserId: "supabase-7",
    email: "user@example.com",
    displayName: "user"
  };

  await assert.rejects(() => service.updateProfile({}, user, { displayName: "" }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.details.fieldErrors.displayName, "Display name is required.");
    return true;
  });

  await assert.rejects(() => service.updatePreferences({}, user, {}), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.details.fieldErrors.preferences, "At least one preference field is required.");
    return true;
  });

  await assert.rejects(() => service.updateNotifications({}, user, { securityAlerts: false }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.details.fieldErrors.securityAlerts, "Security alerts must stay enabled.");
    return true;
  });

  await assert.rejects(
    () =>
      service.changePassword({}, {
        currentPassword: "old-password",
        newPassword: "new-password-123",
        confirmPassword: "different"
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrors.confirmPassword, "Passwords do not match.");
      return true;
    }
  );
});
