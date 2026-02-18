import { AppError } from "../../lib/errors.js";
import { validators as authValidators } from "../../../shared/auth/validators.js";
import { AVATAR_MAX_SIZE, AVATAR_MIN_SIZE } from "../../../shared/avatar/index.js";
import {
  SETTINGS_CURRENCY_CODE_PATTERN,
  SETTINGS_DATE_FORMAT_OPTIONS,
  SETTINGS_NUMBER_FORMAT_OPTIONS,
  SETTINGS_THEME_OPTIONS
} from "../../../shared/settings/index.js";

const CURRENCY_CODE_REGEX = new RegExp(SETTINGS_CURRENCY_CODE_PATTERN);

function validationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isValidLocale(value) {
  try {
    new Intl.Locale(value);
    return true;
  } catch {
    return false;
  }
}

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isValidCurrencyCode(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (!normalized) {
    return false;
  }

  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("currency").includes(normalized);
  }

  try {
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized
    });
    return true;
  } catch {
    return false;
  }
}

function parseProfileInput(payload = {}) {
  const fieldErrors = {};
  const displayName = normalizeText(payload.displayName);

  if (!displayName) {
    fieldErrors.displayName = "Display name is required.";
  } else if (displayName.length > 120) {
    fieldErrors.displayName = "Display name must be at most 120 characters.";
  }

  return {
    displayName,
    fieldErrors
  };
}

function parsePreferencesInput(payload = {}) {
  const fieldErrors = {};
  const patch = {};

  if (hasOwn(payload, "theme")) {
    const theme = normalizeText(payload.theme).toLowerCase();
    if (!SETTINGS_THEME_OPTIONS.includes(theme)) {
      fieldErrors.theme = "Theme must be one of: system, light, dark.";
    } else {
      patch.theme = theme;
    }
  }

  if (hasOwn(payload, "locale")) {
    const locale = normalizeText(payload.locale);
    if (!locale) {
      fieldErrors.locale = "Locale is required.";
    } else if (!isValidLocale(locale)) {
      fieldErrors.locale = "Locale must be a valid BCP 47 locale tag.";
    } else {
      patch.locale = locale;
    }
  }

  if (hasOwn(payload, "timeZone")) {
    const timeZone = normalizeText(payload.timeZone);
    if (!timeZone) {
      fieldErrors.timeZone = "Time zone is required.";
    } else if (!isValidTimeZone(timeZone)) {
      fieldErrors.timeZone = "Time zone must be a valid IANA time zone identifier.";
    } else {
      patch.timeZone = timeZone;
    }
  }

  if (hasOwn(payload, "dateFormat")) {
    const dateFormat = normalizeText(payload.dateFormat).toLowerCase();
    if (!SETTINGS_DATE_FORMAT_OPTIONS.includes(dateFormat)) {
      fieldErrors.dateFormat = "Date format must be one of: system, mdy, dmy, ymd.";
    } else {
      patch.dateFormat = dateFormat;
    }
  }

  if (hasOwn(payload, "numberFormat")) {
    const numberFormat = normalizeText(payload.numberFormat).toLowerCase();
    if (!SETTINGS_NUMBER_FORMAT_OPTIONS.includes(numberFormat)) {
      fieldErrors.numberFormat = "Number format must be one of: system, comma-dot, dot-comma, space-comma.";
    } else {
      patch.numberFormat = numberFormat;
    }
  }

  if (hasOwn(payload, "currencyCode")) {
    const currencyCode = normalizeText(payload.currencyCode).toUpperCase();
    if (!CURRENCY_CODE_REGEX.test(currencyCode)) {
      fieldErrors.currencyCode = "Currency code must be a 3-letter ISO 4217 code.";
    } else if (!isValidCurrencyCode(currencyCode)) {
      fieldErrors.currencyCode = "Currency code is not supported.";
    } else {
      patch.currencyCode = currencyCode;
    }
  }

  if (hasOwn(payload, "avatarSize")) {
    const value = Number(payload.avatarSize);
    if (!Number.isInteger(value) || value < AVATAR_MIN_SIZE || value > AVATAR_MAX_SIZE) {
      fieldErrors.avatarSize = `Avatar size must be an integer from ${AVATAR_MIN_SIZE} to ${AVATAR_MAX_SIZE}.`;
    } else {
      patch.avatarSize = value;
    }
  }

  if (!Object.keys(patch).length && !Object.keys(fieldErrors).length) {
    fieldErrors.preferences = "At least one preference field is required.";
  }

  return {
    patch,
    fieldErrors
  };
}

function parseNotificationsInput(payload = {}) {
  const fieldErrors = {};
  const patch = {};

  if (hasOwn(payload, "productUpdates")) {
    if (typeof payload.productUpdates !== "boolean") {
      fieldErrors.productUpdates = "Product updates setting must be boolean.";
    } else {
      patch.productUpdates = payload.productUpdates;
    }
  }

  if (hasOwn(payload, "accountActivity")) {
    if (typeof payload.accountActivity !== "boolean") {
      fieldErrors.accountActivity = "Account activity setting must be boolean.";
    } else {
      patch.accountActivity = payload.accountActivity;
    }
  }

  if (hasOwn(payload, "securityAlerts")) {
    if (payload.securityAlerts !== true) {
      fieldErrors.securityAlerts = "Security alerts must stay enabled.";
    } else {
      patch.securityAlerts = true;
    }
  }

  if (!Object.keys(patch).length && !Object.keys(fieldErrors).length) {
    fieldErrors.notifications = "At least one notification setting is required.";
  }

  return {
    patch,
    fieldErrors
  };
}

function parseChangePasswordInput(payload = {}, options = {}) {
  const fieldErrors = {};
  const requireCurrentPassword = options.requireCurrentPassword !== false;

  const currentPassword = String(payload.currentPassword || "");
  const newPassword = String(payload.newPassword || "");
  const confirmPassword = String(payload.confirmPassword || "");

  if (requireCurrentPassword) {
    const currentPasswordError = authValidators.loginPassword(currentPassword);
    if (currentPasswordError) {
      fieldErrors.currentPassword = currentPasswordError;
    }
  }

  const newPasswordError = authValidators.registerPassword(newPassword);
  if (newPasswordError) {
    fieldErrors.newPassword = newPasswordError;
  }

  const confirmPasswordError = authValidators.confirmPassword({
    password: newPassword,
    confirmPassword
  });
  if (confirmPasswordError) {
    fieldErrors.confirmPassword = confirmPasswordError;
  }

  if (
    requireCurrentPassword &&
    !fieldErrors.newPassword &&
    !fieldErrors.currentPassword &&
    currentPassword === newPassword
  ) {
    fieldErrors.newPassword = "New password must be different from current password.";
  }

  return {
    currentPassword,
    newPassword,
    confirmPassword,
    fieldErrors
  };
}

function normalizeSecurityStatus(securityStatus) {
  const mfa = securityStatus && typeof securityStatus === "object" ? securityStatus.mfa || {} : {};
  const authPolicy = securityStatus && typeof securityStatus === "object" ? securityStatus.authPolicy || {} : {};
  const rawAuthMethods =
    securityStatus && typeof securityStatus === "object" && Array.isArray(securityStatus.authMethods)
      ? securityStatus.authMethods
      : [];

  const minimumEnabledMethods = Number.isInteger(Number(authPolicy.minimumEnabledMethods))
    ? Math.max(1, Number(authPolicy.minimumEnabledMethods))
    : 1;

  const authMethods = rawAuthMethods.map((method) => {
    const normalized = method && typeof method === "object" ? method : {};
    return {
      id: String(normalized.id || ""),
      kind: String(normalized.kind || ""),
      provider: normalized.provider == null ? null : String(normalized.provider || ""),
      label: String(normalized.label || normalized.id || ""),
      configured: Boolean(normalized.configured),
      enabled: Boolean(normalized.enabled),
      canEnable: Boolean(normalized.canEnable),
      canDisable: Boolean(normalized.canDisable),
      supportsSecretUpdate: Boolean(normalized.supportsSecretUpdate),
      requiresCurrentPassword: Boolean(normalized.requiresCurrentPassword)
    };
  });

  const enabledMethodsCount = authMethods.reduce((count, method) => (method.enabled ? count + 1 : count), 0);

  return {
    mfa: {
      status: String(mfa.status || "not_enabled"),
      enrolled: Boolean(mfa.enrolled),
      methods: Array.isArray(mfa.methods) ? mfa.methods.map((method) => String(method)) : []
    },
    sessions: {
      canSignOutOtherDevices: true
    },
    authPolicy: {
      minimumEnabledMethods,
      enabledMethodsCount
    },
    authMethods
  };
}

function findPasswordAuthMethod(securityStatus) {
  const methods = Array.isArray(securityStatus?.authMethods) ? securityStatus.authMethods : [];
  return methods.find((method) => String(method?.id || "") === "password") || null;
}

function buildSettingsResponse(userProfile, settings, securityStatus, avatar) {
  return {
    profile: {
      displayName: userProfile.displayName,
      email: userProfile.email,
      emailManagedBy: "supabase",
      emailChangeFlow: "supabase",
      avatar
    },
    security: normalizeSecurityStatus(securityStatus),
    preferences: {
      theme: settings.theme,
      locale: settings.locale,
      timeZone: settings.timeZone,
      dateFormat: settings.dateFormat,
      numberFormat: settings.numberFormat,
      currencyCode: settings.currencyCode,
      avatarSize: settings.avatarSize
    },
    notifications: {
      productUpdates: settings.productUpdates,
      accountActivity: settings.accountActivity,
      securityAlerts: settings.securityAlerts
    }
  };
}

function createService({ userSettingsRepository, userProfilesRepository, authService, userAvatarService }) {
  if (!userAvatarService || typeof userAvatarService.buildAvatarResponse !== "function") {
    throw new Error("userAvatarService is required.");
  }

  function resolveAvatar(profile, settings) {
    return userAvatarService.buildAvatarResponse(profile, { avatarSize: settings.avatarSize });
  }

  async function getForUser(request, user) {
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);
    return buildSettingsResponse(user, settings, securityStatus, resolveAvatar(user, settings));
  }

  async function updateProfile(request, user, payload) {
    const parsed = parseProfileInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const updated = await authService.updateDisplayName(request, parsed.displayName);
    const profile =
      updated.profile || (await userProfilesRepository.updateDisplayNameById(user.id, parsed.displayName));
    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return {
      settings: buildSettingsResponse(profile, settings, securityStatus, resolveAvatar(profile, settings)),
      session: updated.session || null
    };
  }

  async function updatePreferences(request, user, payload) {
    const parsed = parsePreferencesInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const settings = await userSettingsRepository.updatePreferences(user.id, parsed.patch);
    const securityStatus = await authService.getSecurityStatus(request);
    return buildSettingsResponse(user, settings, securityStatus, resolveAvatar(user, settings));
  }

  async function updateNotifications(request, user, payload) {
    const parsed = parseNotificationsInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const settings = await userSettingsRepository.updateNotifications(user.id, parsed.patch);
    const securityStatus = await authService.getSecurityStatus(request);
    return buildSettingsResponse(user, settings, securityStatus, resolveAvatar(user, settings));
  }

  async function uploadAvatar(request, user, payload) {
    const upload = await userAvatarService.uploadForUser(user, payload);
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return buildSettingsResponse(upload.profile, settings, securityStatus, resolveAvatar(upload.profile, settings));
  }

  async function deleteAvatar(request, user) {
    const profile = await userAvatarService.clearForUser(user);
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return buildSettingsResponse(profile, settings, securityStatus, resolveAvatar(profile, settings));
  }

  async function changePassword(request, payload) {
    const securityStatus = await authService.getSecurityStatus(request);
    const passwordMethod = findPasswordAuthMethod(securityStatus);
    const requireCurrentPassword = Boolean(passwordMethod?.requiresCurrentPassword);
    const parsedWithPolicy = parseChangePasswordInput(payload, { requireCurrentPassword });
    if (Object.keys(parsedWithPolicy.fieldErrors).length > 0) {
      throw validationError(parsedWithPolicy.fieldErrors);
    }

    const result = await authService.changePassword(request, {
      currentPassword: parsedWithPolicy.currentPassword,
      newPassword: parsedWithPolicy.newPassword,
      requireCurrentPassword
    });

    return {
      ok: true,
      message: requireCurrentPassword ? "Password changed." : "Password set.",
      session: result?.session || null
    };
  }

  async function setPasswordMethodEnabled(request, user, payload) {
    await userSettingsRepository.ensureForUserId(user.id);
    await authService.setPasswordSignInEnabled(request, payload);

    const maybeLatestProfile = user.supabaseUserId
      ? await userProfilesRepository.findBySupabaseUserId(user.supabaseUserId)
      : null;
    const profile = maybeLatestProfile || user;
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return buildSettingsResponse(profile, settings, securityStatus, resolveAvatar(profile, settings));
  }

  async function startOAuthProviderLink(request, user, payload) {
    await userSettingsRepository.ensureForUserId(user.id);
    return authService.startProviderLink(request, payload);
  }

  async function unlinkOAuthProvider(request, user, payload) {
    await authService.unlinkProvider(request, payload);

    const maybeLatestProfile = user.supabaseUserId
      ? await userProfilesRepository.findBySupabaseUserId(user.supabaseUserId)
      : null;
    const profile = maybeLatestProfile || user;
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return buildSettingsResponse(profile, settings, securityStatus, resolveAvatar(profile, settings));
  }

  async function logoutOtherSessions(request) {
    await authService.signOutOtherSessions(request);

    return {
      ok: true,
      message: "Signed out from other active sessions."
    };
  }

  return {
    getForUser,
    updateProfile,
    updatePreferences,
    updateNotifications,
    uploadAvatar,
    deleteAvatar,
    changePassword,
    setPasswordMethodEnabled,
    startOAuthProviderLink,
    unlinkOAuthProvider,
    logoutOtherSessions
  };
}

const __testables = {
  validationError,
  parseProfileInput,
  parsePreferencesInput,
  parseNotificationsInput,
  parseChangePasswordInput,
  normalizeSecurityStatus,
  buildSettingsResponse,
  isValidLocale,
  isValidTimeZone,
  isValidCurrencyCode
};

export { createService, __testables };
