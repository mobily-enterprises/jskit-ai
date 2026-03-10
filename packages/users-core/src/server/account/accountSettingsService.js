import { createHash } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings.js";
import { normalizeIdentity } from "./userProfilesRepository.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function createValidationError(fieldErrors = {}) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function createGravatarUrl(email, size = 64) {
  const normalizedEmail = normalizeLowerText(email);
  const hash = createHash("sha256").update(normalizedEmail).digest("hex");
  return `https://www.gravatar.com/avatar/${hash}?d=mp&s=${Number(size) || 64}`;
}

function normalizeSecurityStatus(securityStatus = {}) {
  const source = securityStatus && typeof securityStatus === "object" ? securityStatus : {};
  const authPolicy = source.authPolicy && typeof source.authPolicy === "object" ? source.authPolicy : {};
  const authMethods = Array.isArray(source.authMethods) ? source.authMethods : [];
  const enabledMethodsCount = authMethods.filter((method) => method?.enabled === true).length;

  return {
    mfa: {
      status: normalizeText(source?.mfa?.status) || "not_enabled",
      enrolled: Boolean(source?.mfa?.enrolled),
      methods: Array.isArray(source?.mfa?.methods) ? source.mfa.methods.map((entry) => normalizeText(entry)).filter(Boolean) : []
    },
    sessions: {
      canSignOutOtherDevices: true
    },
    authPolicy: {
      minimumEnabledMethods: Number(authPolicy.minimumEnabledMethods) > 0 ? Number(authPolicy.minimumEnabledMethods) : 1,
      enabledMethodsCount
    },
    authMethods: authMethods.map((method) => ({
      id: normalizeText(method?.id),
      kind: normalizeText(method?.kind),
      provider: method?.provider == null ? null : normalizeText(method.provider),
      label: normalizeText(method?.label || method?.id),
      configured: method?.configured === true,
      enabled: method?.enabled === true,
      canEnable: method?.canEnable === true,
      canDisable: method?.canDisable === true,
      supportsSecretUpdate: method?.supportsSecretUpdate === true,
      requiresCurrentPassword: method?.requiresCurrentPassword === true
    }))
  };
}

function resolveAuthProfileContract(authService) {
  if (!authService || typeof authService.getSettingsProfileAuthInfo !== "function") {
    return {
      emailManagedBy: "auth",
      emailChangeFlow: "auth"
    };
  }

  const contract = authService.getSettingsProfileAuthInfo();
  return {
    emailManagedBy: normalizeLowerText(contract?.emailManagedBy) || "auth",
    emailChangeFlow: normalizeLowerText(contract?.emailChangeFlow) || "auth"
  };
}

function parsePreferencesPatch(payload = {}) {
  const source = normalizeObjectInput(payload);
  const patch = pickOwnProperties(source, [
    "theme",
    "locale",
    "timeZone",
    "dateFormat",
    "numberFormat",
    "currencyCode",
    "avatarSize"
  ]);

  if (Object.keys(patch).length < 1) {
    throw createValidationError({
      preferences: "At least one preference field is required."
    });
  }

  return patch;
}

function parseNotificationsPatch(payload = {}) {
  const source = pickOwnProperties(normalizeObjectInput(payload), [
    "productUpdates",
    "accountActivity",
    "securityAlerts"
  ]);
  const patch = {};

  for (const [key, value] of Object.entries(source)) {
    patch[key] = value === true;
  }

  if (Object.keys(patch).length < 1) {
    throw createValidationError({
      notifications: "At least one notification setting is required."
    });
  }

  return patch;
}

function parseChatPatch(payload = {}) {
  const source = normalizeObjectInput(payload);
  const patch = pickOwnProperties(source, [
    "publicChatId",
    "allowWorkspaceDms",
    "allowGlobalDms",
    "requireSharedWorkspaceForGlobalDm",
    "discoverableByPublicChatId"
  ]);

  if (Object.keys(patch).length < 1) {
    throw createValidationError({
      chat: "At least one chat setting is required."
    });
  }

  return patch;
}

function parseChangePassword(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const currentPassword = String(source.currentPassword || "");
  const newPassword = String(source.newPassword || "");
  const confirmPassword = String(source.confirmPassword || "");
  const fieldErrors = {};

  if (!newPassword || newPassword.length < 8) {
    fieldErrors.newPassword = "Password must be at least 8 characters.";
  }

  if (!confirmPassword || confirmPassword !== newPassword) {
    fieldErrors.confirmPassword = "Password confirmation does not match.";
  }

  return {
    currentPassword,
    newPassword,
    confirmPassword,
    fieldErrors
  };
}

function createService({
  userSettingsRepository,
  userProfilesRepository,
  authService
} = {}) {
  if (!userSettingsRepository || !userProfilesRepository) {
    throw new Error("settingsService requires repositories.");
  }

  async function resolveUserProfile(user) {
    const identity = normalizeIdentity(user);
    if (identity) {
      const profile = await userProfilesRepository.findByIdentity(identity);
      if (profile) {
        return profile;
      }
    }

    const userId = Number(user?.id);
    if (Number.isInteger(userId) && userId > 0) {
      const profileById = await userProfilesRepository.findById(userId);
      if (profileById) {
        return profileById;
      }
    }

    return null;
  }

  function buildAvatar(profile, settings) {
    const size = Number(settings?.avatarSize || DEFAULT_USER_SETTINGS.avatarSize);
    const uploadedUrl = null;
    const gravatarUrl = createGravatarUrl(profile?.email, size);
    return {
      uploadedUrl,
      gravatarUrl,
      effectiveUrl: uploadedUrl || gravatarUrl,
      hasUploadedAvatar: Boolean(uploadedUrl),
      size,
      version: profile?.avatarVersion || null
    };
  }

  function buildSettingsResponse(profile, settings, securityStatus) {
    const contract = resolveAuthProfileContract(authService);
    return {
      profile: {
        displayName: normalizeText(profile?.displayName),
        email: normalizeLowerText(profile?.email),
        emailManagedBy: contract.emailManagedBy,
        emailChangeFlow: contract.emailChangeFlow,
        avatar: buildAvatar(profile, settings)
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
      chat: {
        ...(DEFAULT_USER_SETTINGS.chatSettings || {}),
        ...(settings.chatSettings && typeof settings.chatSettings === "object" ? settings.chatSettings : {})
      }
    };
  }

  async function getForUser(request, user) {
    const profile = await resolveUserProfile(user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus =
      authService && typeof authService.getSecurityStatus === "function"
        ? await authService.getSecurityStatus(request)
        : {};

    return buildSettingsResponse(profile, settings, securityStatus);
  }

  async function updateProfile(request, user, payload = {}) {
    const profile = await resolveUserProfile(user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const displayName = normalizeText(payload.displayName);
    if (!displayName) {
      throw createValidationError({
        displayName: "Display name is required."
      });
    }

    let session = null;
    let updatedProfile = null;
    if (authService && typeof authService.updateDisplayName === "function") {
      const result = await authService.updateDisplayName(request, displayName);
      session = result?.session || null;
      updatedProfile = result?.profile || null;
    }

    if (!updatedProfile) {
      updatedProfile = await userProfilesRepository.updateDisplayNameById(profile.id, displayName);
    }

    const settings = await userSettingsRepository.ensureForUserId(updatedProfile.id);
    const securityStatus =
      authService && typeof authService.getSecurityStatus === "function"
        ? await authService.getSecurityStatus(request)
        : {};

    return {
      session,
      settings: buildSettingsResponse(updatedProfile, settings, securityStatus)
    };
  }

  async function updatePreferences(request, user, payload = {}) {
    const profile = await resolveUserProfile(user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const patch = parsePreferencesPatch(payload);
    const settings = await userSettingsRepository.updatePreferences(profile.id, patch);
    const securityStatus =
      authService && typeof authService.getSecurityStatus === "function"
        ? await authService.getSecurityStatus(request)
        : {};

    return buildSettingsResponse(profile, settings, securityStatus);
  }

  async function updateNotifications(request, user, payload = {}) {
    const profile = await resolveUserProfile(user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const patch = parseNotificationsPatch(payload);
    const settings = await userSettingsRepository.updateNotifications(profile.id, patch);
    const securityStatus =
      authService && typeof authService.getSecurityStatus === "function"
        ? await authService.getSecurityStatus(request)
        : {};

    return buildSettingsResponse(profile, settings, securityStatus);
  }

  async function updateChat(request, user, payload = {}) {
    const profile = await resolveUserProfile(user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const patch = parseChatPatch(payload);
    const settings = await userSettingsRepository.updateChatSettings(profile.id, patch);
    const securityStatus =
      authService && typeof authService.getSecurityStatus === "function"
        ? await authService.getSecurityStatus(request)
        : {};

    return buildSettingsResponse(profile, settings, securityStatus);
  }

  async function changePassword(request, user, payload = {}) {
    if (!authService || typeof authService.changePassword !== "function") {
      throw new AppError(501, "Password change is not available.");
    }

    const parsed = parseChangePassword(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw createValidationError(parsed.fieldErrors);
    }

    return authService.changePassword(request, {
      currentPassword: parsed.currentPassword,
      newPassword: parsed.newPassword,
      confirmPassword: parsed.confirmPassword
    });
  }

  async function setPasswordMethodEnabled(request, user, payload = {}) {
    if (!authService || typeof authService.setPasswordSignInEnabled !== "function") {
      throw new AppError(501, "Password method toggle is not available.");
    }

    const enabled = payload.enabled === true;
    const profile = await resolveUserProfile(user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const response = await authService.setPasswordSignInEnabled(request, {
      enabled
    });
    await userSettingsRepository.updatePasswordSignInEnabled(profile.id, enabled);
    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus =
      authService && typeof authService.getSecurityStatus === "function"
        ? await authService.getSecurityStatus(request)
        : {};

    return {
      ...(response && typeof response === "object" ? response : {}),
      settings: buildSettingsResponse(profile, settings, securityStatus)
    };
  }

  async function startOAuthProviderLink(request, user, payload = {}) {
    if (!authService || typeof authService.startProviderLink !== "function") {
      throw new AppError(501, "OAuth linking is not available.");
    }

    return authService.startProviderLink(request, {
      provider: payload.provider,
      returnTo: payload.returnTo
    });
  }

  async function unlinkOAuthProvider(request, user, payload = {}) {
    if (!authService || typeof authService.unlinkProvider !== "function") {
      throw new AppError(501, "OAuth unlink is not available.");
    }

    return authService.unlinkProvider(request, {
      provider: payload.provider
    });
  }

  async function logoutOtherSessions(request) {
    if (!authService || typeof authService.signOutOtherSessions !== "function") {
      throw new AppError(501, "Logout other sessions is not available.");
    }

    return authService.signOutOtherSessions(request);
  }

  async function uploadAvatar() {
    throw new AppError(501, "Avatar upload is not implemented in users-core yet.");
  }

  async function deleteAvatar() {
    throw new AppError(501, "Avatar deletion is not implemented in users-core yet.");
  }

  return Object.freeze({
    getForUser,
    updateProfile,
    updatePreferences,
    updateNotifications,
    updateChat,
    changePassword,
    setPasswordMethodEnabled,
    startOAuthProviderLink,
    unlinkOAuthProvider,
    logoutOtherSessions,
    uploadAvatar,
    deleteAvatar
  });
}

export { createService };
