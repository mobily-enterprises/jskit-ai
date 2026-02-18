import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../lib/errors.js";
import { createUserSettingsService, __testables } from "../server/modules/settings/service.js";

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
    avatarSize: 64,
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
  assert.deepEqual(Object.keys(preferencesInvalid.fieldErrors).sort(), [
    "currencyCode",
    "dateFormat",
    "locale",
    "numberFormat",
    "theme",
    "timeZone"
  ]);
  assert.equal(preferencesInvalid.fieldErrors.defaultMode, undefined);
  assert.equal(preferencesInvalid.fieldErrors.defaultTiming, undefined);
  assert.equal(preferencesInvalid.fieldErrors.defaultPaymentsPerYear, undefined);
  assert.equal(preferencesInvalid.fieldErrors.defaultHistoryPageSize, undefined);

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
  assert.equal(preferencesValid.patch.theme, "dark");
  assert.equal(preferencesValid.patch.locale, "en-GB");
  assert.equal(preferencesValid.patch.timeZone, "Europe/London");
  assert.equal(preferencesValid.patch.dateFormat, "dmy");
  assert.equal(preferencesValid.patch.numberFormat, "dot-comma");
  assert.equal(preferencesValid.patch.currencyCode, "EUR");
  assert.equal(preferencesValid.patch.defaultMode, undefined);
  assert.equal(preferencesValid.patch.defaultTiming, undefined);
  assert.equal(preferencesValid.patch.defaultPaymentsPerYear, undefined);
  assert.equal(preferencesValid.patch.defaultHistoryPageSize, undefined);

  const preferencesInvalidLocale = __testables.parsePreferencesInput({ locale: "bad-@@" });
  assert.equal(preferencesInvalidLocale.fieldErrors.locale, "Locale must be a valid BCP 47 locale tag.");

  const preferencesMissingTimeZone = __testables.parsePreferencesInput({ timeZone: "" });
  assert.equal(preferencesMissingTimeZone.fieldErrors.timeZone, "Time zone is required.");

  const preferencesUnsupportedCurrency = __testables.parsePreferencesInput({ currencyCode: "ZZZ" });
  assert.equal(preferencesUnsupportedCurrency.fieldErrors.currencyCode, "Currency code is not supported.");

  const preferencesInvalidAvatarSize = __testables.parsePreferencesInput({ avatarSize: 20 });
  assert.equal(preferencesInvalidAvatarSize.fieldErrors.avatarSize, "Avatar size must be an integer from 32 to 128.");

  const preferencesValidAvatarSize = __testables.parsePreferencesInput({ avatarSize: 96 });
  assert.equal(preferencesValidAvatarSize.patch.avatarSize, 96);

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
  assert.equal(
    notificationsInvalidBooleanTypes.fieldErrors.accountActivity,
    "Account activity setting must be boolean."
  );

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

  const securitySparseMethods = __testables.normalizeSecurityStatus({
    authMethods: [
      null,
      {
        id: null,
        kind: null,
        provider: "",
        label: "",
        configured: 0,
        enabled: 0
      },
      {
        id: "password",
        kind: "password",
        provider: null
      }
    ]
  });
  assert.equal(securitySparseMethods.authMethods[0].id, "");
  assert.equal(securitySparseMethods.authMethods[0].kind, "");
  assert.equal(securitySparseMethods.authMethods[0].provider, null);
  assert.equal(securitySparseMethods.authMethods[0].label, "");
  assert.equal(securitySparseMethods.authMethods[1].provider, "");
  assert.equal(securitySparseMethods.authMethods[1].label, "");
  assert.equal(securitySparseMethods.authMethods[2].provider, null);
  assert.equal(securitySparseMethods.authMethods[2].label, "password");

  const response = __testables.buildSettingsResponse(
    { displayName: "user", email: "user@example.com" },
    buildSettings(),
    {
      mfa: {
        status: "enabled",
        enrolled: true,
        methods: ["totp"]
      }
    },
    {
      uploadedUrl: null,
      gravatarUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
      effectiveUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
      hasUploadedAvatar: false,
      size: 64,
      version: null
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
          avatarStorageKey: null,
          avatarVersion: null,
          avatarUpdatedAt: null,
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      }
    },
    userAvatarService: {
      buildAvatarResponse(profile, { avatarSize }) {
        calls.push(["buildAvatarResponse", profile.id, avatarSize]);
        return {
          uploadedUrl: profile.avatarStorageKey ? `/uploads/${profile.avatarStorageKey}` : null,
          gravatarUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
          effectiveUrl: profile.avatarStorageKey
            ? `/uploads/${profile.avatarStorageKey}`
            : "https://www.gravatar.com/avatar/hash?d=mp&s=64",
          hasUploadedAvatar: Boolean(profile.avatarStorageKey),
          size: Number(avatarSize || 64),
          version: profile.avatarVersion || null
        };
      },
      async uploadForUser() {
        throw new Error("not used");
      },
      async clearForUser() {
        throw new Error("not used");
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
          },
          authMethods: [
            {
              id: "password",
              kind: "password",
              provider: "email",
              label: "Password",
              configured: true,
              enabled: true,
              canEnable: false,
              canDisable: true,
              supportsSecretUpdate: true,
              requiresCurrentPassword: true
            }
          ]
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
            avatarStorageKey: null,
            avatarVersion: null,
            avatarUpdatedAt: null,
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
          avatarStorageKey: null,
          avatarVersion: null,
          avatarUpdatedAt: null,
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      }
    },
    userAvatarService: {
      buildAvatarResponse(_profile, { avatarSize }) {
        return {
          uploadedUrl: null,
          gravatarUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
          effectiveUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
          hasUploadedAvatar: false,
          size: Number(avatarSize || 64),
          version: null
        };
      },
      async uploadForUser() {
        throw new Error("not used");
      },
      async clearForUser() {
        throw new Error("not used");
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

  const profileUpdated = await service.updateProfile({ marker: "fallback-profile" }, user, {
    displayName: "fallback-name"
  });
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

test("user settings service handles avatar upload and delete flows", async () => {
  const calls = [];
  const service = createUserSettingsService({
    userSettingsRepository: {
      async ensureForUserId(userId) {
        calls.push(["ensureForUserId", userId]);
        return buildSettings({ userId, avatarSize: 80 });
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
        throw new Error("not used");
      }
    },
    userAvatarService: {
      buildAvatarResponse(profile, { avatarSize }) {
        calls.push(["buildAvatarResponse", profile.id, avatarSize]);
        const uploadedUrl = profile.avatarStorageKey ? `/uploads/${profile.avatarStorageKey}` : null;
        return {
          uploadedUrl,
          gravatarUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=80",
          effectiveUrl: uploadedUrl || "https://www.gravatar.com/avatar/hash?d=mp&s=80",
          hasUploadedAvatar: Boolean(uploadedUrl),
          size: Number(avatarSize || 80),
          version: profile.avatarVersion || null
        };
      },
      async uploadForUser(user, payload) {
        calls.push(["uploadForUser", user.id, payload.mimeType]);
        return {
          profile: {
            ...user,
            avatarStorageKey: "avatars/users/7/avatar.webp",
            avatarVersion: "123"
          },
          image: {
            mimeType: "image/webp",
            bytes: 100,
            width: 256,
            height: 256
          }
        };
      },
      async clearForUser(user) {
        calls.push(["clearForUser", user.id]);
        return {
          ...user,
          avatarStorageKey: null,
          avatarVersion: null
        };
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

  const uploaded = await service.uploadAvatar({}, user, {
    stream: {},
    mimeType: "image/png",
    uploadDimension: 256
  });
  assert.equal(uploaded.profile.avatar.hasUploadedAvatar, true);
  assert.equal(uploaded.profile.avatar.version, "123");

  const cleared = await service.deleteAvatar({}, user);
  assert.equal(cleared.profile.avatar.hasUploadedAvatar, false);
  assert.ok(calls.some((entry) => entry[0] === "uploadForUser"));
  assert.ok(calls.some((entry) => entry[0] === "clearForUser"));
});

test("user settings service orchestrates password method toggle and oauth link/unlink flows", async () => {
  const calls = [];
  const securityStatus = {
    mfa: {
      status: "not_enabled",
      enrolled: false,
      methods: []
    },
    authPolicy: {
      minimumEnabledMethods: 1,
      enabledMethodsCount: 2
    },
    authMethods: [
      {
        id: "password",
        kind: "password",
        provider: "email",
        label: "Password",
        configured: true,
        enabled: false,
        canEnable: true,
        canDisable: false,
        supportsSecretUpdate: true,
        requiresCurrentPassword: false
      },
      {
        id: "oauth-google",
        kind: "oauth",
        provider: "google",
        label: "Google",
        configured: true,
        enabled: true,
        canEnable: false,
        canDisable: true,
        supportsSecretUpdate: false,
        requiresCurrentPassword: false
      }
    ]
  };

  const service = createUserSettingsService({
    userSettingsRepository: {
      async ensureForUserId(userId) {
        calls.push(["ensureForUserId", userId]);
        return buildSettings({ userId, avatarSize: 72 });
      },
      async updatePreferences() {
        return buildSettings();
      },
      async updateNotifications() {
        return buildSettings();
      }
    },
    userProfilesRepository: {
      async findBySupabaseUserId(supabaseUserId) {
        calls.push(["findBySupabaseUserId", supabaseUserId]);
        return {
          id: 7,
          supabaseUserId,
          email: "fresh@example.com",
          displayName: "fresh-user",
          avatarStorageKey: null,
          avatarVersion: null,
          avatarUpdatedAt: null,
          createdAt: "2024-01-01T00:00:00.000Z"
        };
      },
      async updateDisplayNameById() {
        throw new Error("not used");
      }
    },
    userAvatarService: {
      buildAvatarResponse(profile, { avatarSize }) {
        calls.push(["buildAvatarResponse", profile.id, avatarSize]);
        return {
          uploadedUrl: null,
          gravatarUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=72",
          effectiveUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=72",
          hasUploadedAvatar: false,
          size: Number(avatarSize || 72),
          version: null
        };
      },
      async uploadForUser() {
        throw new Error("not used");
      },
      async clearForUser() {
        throw new Error("not used");
      }
    },
    authService: {
      async getSecurityStatus(request) {
        calls.push(["getSecurityStatus", request.marker]);
        return securityStatus;
      },
      async setPasswordSignInEnabled(request, payload) {
        calls.push(["setPasswordSignInEnabled", request.marker, payload]);
      },
      async startProviderLink(request, payload) {
        calls.push(["startProviderLink", request.marker, payload]);
        return {
          authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth"
        };
      },
      async unlinkProvider(request, payload) {
        calls.push(["unlinkProvider", request.marker, payload]);
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

  const methodResult = await service.setPasswordMethodEnabled({ marker: "toggle-password" }, user, {
    enabled: true
  });
  assert.equal(methodResult.profile.email, "fresh@example.com");
  assert.equal(methodResult.security.authMethods.find((method) => method.id === "password")?.enabled, false);
  assert.equal(
    calls.some(
      (entry) =>
        entry[0] === "setPasswordSignInEnabled" &&
        entry[1] === "toggle-password" &&
        entry[2] &&
        entry[2].enabled === true
    ),
    true
  );

  const linkResult = await service.startOAuthProviderLink({ marker: "start-link" }, user, {
    provider: "google"
  });
  assert.equal(linkResult.authorizationUrl.includes("accounts.google.com"), true);
  assert.equal(
    calls.some(
      (entry) =>
        entry[0] === "startProviderLink" && entry[1] === "start-link" && entry[2] && entry[2].provider === "google"
    ),
    true
  );

  const unlinkResult = await service.unlinkOAuthProvider({ marker: "unlink-provider" }, user, {
    provider: "google"
  });
  assert.equal(unlinkResult.profile.email, "fresh@example.com");
  assert.equal(
    calls.some(
      (entry) =>
        entry[0] === "unlinkProvider" && entry[1] === "unlink-provider" && entry[2] && entry[2].provider === "google"
    ),
    true
  );
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
    userAvatarService: {
      buildAvatarResponse(_profile, { avatarSize }) {
        return {
          uploadedUrl: null,
          gravatarUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
          effectiveUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
          hasUploadedAvatar: false,
          size: Number(avatarSize || 64),
          version: null
        };
      },
      async uploadForUser() {
        throw new Error("not used");
      },
      async clearForUser() {
        throw new Error("not used");
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

  await assert.rejects(
    () => service.updateProfile({}, user, { displayName: "" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrors.displayName, "Display name is required.");
      return true;
    }
  );

  await assert.rejects(
    () => service.updatePreferences({}, user, {}),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrors.preferences, "At least one preference field is required.");
      return true;
    }
  );

  await assert.rejects(
    () => service.updateNotifications({}, user, { securityAlerts: false }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrors.securityAlerts, "Security alerts must stay enabled.");
      return true;
    }
  );

  await assert.rejects(
    () =>
      service.changePassword(
        {},
        {
          currentPassword: "old-password",
          newPassword: "new-password-123",
          confirmPassword: "different"
        }
      ),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.details.fieldErrors.confirmPassword, "Passwords do not match.");
      return true;
    }
  );
});

test("user settings service supports password fallback mode and user-profile fallback branches", async () => {
  assert.throws(
    () =>
      createUserSettingsService({
        userSettingsRepository: {},
        userProfilesRepository: {},
        authService: {}
      }),
    /userAvatarService is required/
  );

  let profileLookupCalls = 0;
  const service = createUserSettingsService({
    userSettingsRepository: {
      async ensureForUserId(userId) {
        return buildSettings({ userId, avatarSize: 64 });
      },
      async updatePreferences() {
        return buildSettings();
      },
      async updateNotifications() {
        return buildSettings();
      }
    },
    userProfilesRepository: {
      async findBySupabaseUserId() {
        profileLookupCalls += 1;
        return null;
      },
      async updateDisplayNameById() {
        throw new Error("not used");
      }
    },
    userAvatarService: {
      buildAvatarResponse(profile, { avatarSize }) {
        return {
          uploadedUrl: null,
          gravatarUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
          effectiveUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
          hasUploadedAvatar: false,
          size: Number(avatarSize || 64),
          version: profile.avatarVersion || null
        };
      },
      async uploadForUser() {
        throw new Error("not used");
      },
      async clearForUser() {
        throw new Error("not used");
      }
    },
    authService: {
      async getSecurityStatus() {
        return {
          authMethods: [
            {},
            {
              id: "email_otp",
              kind: "otp",
              provider: "email",
              enabled: true,
              requiresCurrentPassword: false
            }
          ]
        };
      },
      async changePassword() {
        return {
          session: null
        };
      },
      async setPasswordSignInEnabled() {},
      async startProviderLink() {
        throw new Error("not used");
      },
      async unlinkProvider() {},
      async updateDisplayName() {
        throw new Error("not used");
      },
      async signOutOtherSessions() {}
    }
  });

  const userWithoutSupabaseId = {
    id: 11,
    email: "fallback@example.com",
    displayName: "fallback-user"
  };

  const changedPassword = await service.changePassword(
    { marker: "no-password-method" },
    {
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    }
  );
  assert.equal(changedPassword.message, "Password set.");

  const toggled = await service.setPasswordMethodEnabled({ marker: "toggle-no-supabase" }, userWithoutSupabaseId, {
    enabled: true
  });
  assert.equal(toggled.profile.email, "fallback@example.com");

  const unlinked = await service.unlinkOAuthProvider({ marker: "unlink-no-supabase" }, userWithoutSupabaseId, {
    provider: "google"
  });
  assert.equal(unlinked.profile.email, "fallback@example.com");

  assert.equal(profileLookupCalls, 0);
});
