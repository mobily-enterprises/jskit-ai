import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createAuthorizedService } from "@jskit-ai/kernel/server/runtime";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../common/formatters/accountSettingsResponseFormatter.js";

function createService({
  userSettingsRepository,
  userProfilesRepository,
  authService
} = {}) {
  if (!userSettingsRepository || !userProfilesRepository) {
    throw new Error("accountNotificationsService requires repositories.");
  }

  const servicePermissions = Object.freeze({
    updateNotifications: Object.freeze({
      require: "authenticated"
    })
  });

  async function updateNotifications(request, user, payload = {}, options = {}) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const settings = await userSettingsRepository.updateNotifications(profile.id, payload);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    });
  }

  return createAuthorizedService(
    {
      updateNotifications
    },
    servicePermissions
  );
}

export { createService };
