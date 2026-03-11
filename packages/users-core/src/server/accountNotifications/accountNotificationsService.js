import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createValidationError } from "@jskit-ai/kernel/server/runtime";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../account/common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../account/common/formatters/accountSettingsResponseFormatter.js";

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

function createService({
  userSettingsRepository,
  userProfilesRepository,
  authService
} = {}) {
  if (!userSettingsRepository || !userProfilesRepository) {
    throw new Error("accountNotificationsService requires repositories.");
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

  return Object.freeze({
    updateNotifications
  });
}

export { createService };
