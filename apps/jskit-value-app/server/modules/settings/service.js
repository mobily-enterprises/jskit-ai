import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { isMysqlDuplicateEntryError } from "@jskit-ai/knex-mysql-core/mysqlErrors";
import { validators as authValidators } from "@jskit-ai/access-core/validators";
import { SETTINGS_FIELD_SPECS } from "@jskit-ai/workspace-console-core/settingsModel";
import { buildPatch } from "@jskit-ai/workspace-console-core/settingsPatchBuilder";
import { resolveProfileIdentity } from "@jskit-ai/user-profile-core/profileIdentity";
import {
  isValidCurrencyCode,
  isValidLocale,
  isValidTimeZone,
  toTrimmedString
} from "@jskit-ai/workspace-console-core/settingsValidation";

function validationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function normalizeText(value) {
  return toTrimmedString(value);
}

function duplicateEntryTargetsPublicChatId(error) {
  if (!isMysqlDuplicateEntryError(error)) {
    return false;
  }

  const message = String(error?.sqlMessage || error?.message || "").toLowerCase();
  return message.includes("public_chat_id") || message.includes("uq_chat_user_settings_public_chat_id");
}

function parseProfileInput(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const fieldErrors = {};
  let displayName = "";

  try {
    displayName = SETTINGS_FIELD_SPECS.profile.displayName.normalize(source.displayName);
  } catch (error) {
    fieldErrors.displayName = String(error?.message || "Display name is invalid.");
  }

  return {
    displayName,
    fieldErrors
  };
}

function parsePreferencesInput(payload = {}) {
  return buildPatch({
    input: payload,
    fieldSpecs: SETTINGS_FIELD_SPECS.preferences,
    requireAtLeastOne: true,
    emptyField: "preferences",
    emptyMessage: "At least one preference field is required.",
    throwOnError: false
  });
}

function parseNotificationsInput(payload = {}) {
  return buildPatch({
    input: payload,
    fieldSpecs: SETTINGS_FIELD_SPECS.notifications,
    requireAtLeastOne: true,
    emptyField: "notifications",
    emptyMessage: "At least one notification setting is required.",
    throwOnError: false
  });
}

function parseChatInput(payload = {}) {
  return buildPatch({
    input: payload,
    fieldSpecs: SETTINGS_FIELD_SPECS.chat,
    requireAtLeastOne: true,
    emptyField: "chat",
    emptyMessage: "At least one chat setting is required.",
    throwOnError: false
  });
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

function normalizeChatSettings(chatSettings) {
  const source = chatSettings && typeof chatSettings === "object" ? chatSettings : {};
  const publicChatId = normalizeText(source.publicChatId);

  return {
    publicChatId: publicChatId || null,
    allowWorkspaceDms: Boolean(source.allowWorkspaceDms),
    allowGlobalDms: Boolean(source.allowGlobalDms),
    requireSharedWorkspaceForGlobalDm: Boolean(source.requireSharedWorkspaceForGlobalDm),
    discoverableByPublicChatId: Boolean(source.discoverableByPublicChatId)
  };
}

function resolveAuthProfileContract(authService) {
  if (!authService || typeof authService.getSettingsProfileAuthInfo !== "function") {
    throw new Error("authService.getSettingsProfileAuthInfo is required.");
  }

  const rawContract = authService.getSettingsProfileAuthInfo();
  const source = rawContract && typeof rawContract === "object" ? rawContract : {};
  const emailManagedBy = String(source.emailManagedBy || "")
    .trim()
    .toLowerCase();
  const emailChangeFlow = String(source.emailChangeFlow || "")
    .trim()
    .toLowerCase();

  if (!emailManagedBy || !emailChangeFlow) {
    throw new Error("authService.getSettingsProfileAuthInfo must return emailManagedBy and emailChangeFlow.");
  }

  return {
    emailManagedBy,
    emailChangeFlow
  };
}

function buildSettingsResponse(userProfile, settings, securityStatus, avatar, chatSettings, authProfileContract) {
  return {
    profile: {
      displayName: userProfile.displayName,
      email: userProfile.email,
      emailManagedBy: authProfileContract.emailManagedBy,
      emailChangeFlow: authProfileContract.emailChangeFlow,
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
    },
    chat: normalizeChatSettings(chatSettings)
  };
}

function createService({
  userSettingsRepository,
  chatUserSettingsRepository,
  userProfilesRepository,
  authService,
  userAvatarService
}) {
  if (!userAvatarService || typeof userAvatarService.buildAvatarResponse !== "function") {
    throw new Error("userAvatarService is required.");
  }
  if (
    !chatUserSettingsRepository ||
    typeof chatUserSettingsRepository.ensureForUserId !== "function" ||
    typeof chatUserSettingsRepository.updateByUserId !== "function"
  ) {
    throw new Error("chatUserSettingsRepository is required.");
  }
  const authProfileContract = resolveAuthProfileContract(authService);

  async function resolveLatestProfileByIdentity(user) {
    const identity = resolveProfileIdentity(user);
    if (!identity) {
      return null;
    }
    if (typeof userProfilesRepository.findByIdentity !== "function") {
      throw new Error("userProfilesRepository.findByIdentity is required.");
    }

    return userProfilesRepository.findByIdentity(identity);
  }

  function resolveAvatar(profile, settings) {
    return userAvatarService.buildAvatarResponse(profile, { avatarSize: settings.avatarSize });
  }

  function buildResponse(userProfile, settings, securityStatus, chatSettings) {
    return buildSettingsResponse(
      userProfile,
      settings,
      securityStatus,
      resolveAvatar(userProfile, settings),
      chatSettings,
      authProfileContract
    );
  }

  async function getForUser(request, user) {
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const chatSettings = await chatUserSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);
    return buildResponse(user, settings, securityStatus, chatSettings);
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
    const chatSettings = await chatUserSettingsRepository.ensureForUserId(profile.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return {
      settings: buildResponse(profile, settings, securityStatus, chatSettings),
      session: updated.session || null
    };
  }

  async function updatePreferences(request, user, payload) {
    const parsed = parsePreferencesInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const settings = await userSettingsRepository.updatePreferences(user.id, parsed.patch);
    const chatSettings = await chatUserSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);
    return buildResponse(user, settings, securityStatus, chatSettings);
  }

  async function updateNotifications(request, user, payload) {
    const parsed = parseNotificationsInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const settings = await userSettingsRepository.updateNotifications(user.id, parsed.patch);
    const chatSettings = await chatUserSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);
    return buildResponse(user, settings, securityStatus, chatSettings);
  }

  async function updateChat(request, user, payload) {
    const parsed = parseChatInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    let chatSettings;
    try {
      chatSettings = await chatUserSettingsRepository.updateByUserId(user.id, parsed.patch);
    } catch (error) {
      if (duplicateEntryTargetsPublicChatId(error)) {
        throw validationError({
          publicChatId: "Public chat id is already in use."
        });
      }
      throw error;
    }

    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);
    return buildResponse(user, settings, securityStatus, chatSettings);
  }

  async function uploadAvatar(request, user, payload) {
    const upload = await userAvatarService.uploadForUser(user, payload);
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const chatSettings = await chatUserSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return buildResponse(upload.profile, settings, securityStatus, chatSettings);
  }

  async function deleteAvatar(request, user) {
    const profile = await userAvatarService.clearForUser(user);
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const chatSettings = await chatUserSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return buildResponse(profile, settings, securityStatus, chatSettings);
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

    const maybeLatestProfile = await resolveLatestProfileByIdentity(user);
    const profile = maybeLatestProfile || user;
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const chatSettings = await chatUserSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return buildResponse(profile, settings, securityStatus, chatSettings);
  }

  async function startOAuthProviderLink(request, user, payload) {
    await userSettingsRepository.ensureForUserId(user.id);
    return authService.startProviderLink(request, payload);
  }

  async function unlinkOAuthProvider(request, user, payload) {
    await authService.unlinkProvider(request, payload);

    const maybeLatestProfile = await resolveLatestProfileByIdentity(user);
    const profile = maybeLatestProfile || user;
    const settings = await userSettingsRepository.ensureForUserId(user.id);
    const chatSettings = await chatUserSettingsRepository.ensureForUserId(user.id);
    const securityStatus = await authService.getSecurityStatus(request);

    return buildResponse(profile, settings, securityStatus, chatSettings);
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
    updateChat,
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
  parseChatInput,
  parseChangePasswordInput,
  normalizeSecurityStatus,
  normalizeChatSettings,
  duplicateEntryTargetsPublicChatId,
  resolveAuthProfileContract,
  buildSettingsResponse,
  isValidLocale,
  isValidTimeZone,
  isValidCurrencyCode
};

export { createService, __testables };
