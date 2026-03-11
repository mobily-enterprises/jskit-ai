import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createValidationError } from "@jskit-ai/kernel/server/runtime";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "./common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "./common/formatters/accountSettingsResponseFormatter.js";

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

function createService({
  userSettingsRepository,
  userProfilesRepository,
  authService
} = {}) {
  if (!userSettingsRepository || !userProfilesRepository) {
    throw new Error("settingsService requires repositories.");
  }

  async function updatePreferences(request, user, payload = {}) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const patch = parsePreferencesPatch(payload);
    const settings = await userSettingsRepository.updatePreferences(profile.id, patch);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    });
  }

  async function updateNotifications(request, user, payload = {}) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const patch = parseNotificationsPatch(payload);
    const settings = await userSettingsRepository.updateNotifications(profile.id, patch);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    });
  }

  async function updateChat(request, user, payload = {}) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const patch = parseChatPatch(payload);
    const settings = await userSettingsRepository.updateChatSettings(profile.id, patch);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    });
  }

  return Object.freeze({
    updatePreferences,
    updateNotifications,
    updateChat
  });
}

export { createService };
