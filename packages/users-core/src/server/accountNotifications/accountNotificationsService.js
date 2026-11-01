import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../common/formatters/accountSettingsResponseFormatter.js";

/**
 * A signed-in user's notification settings.
 * @param {object} dependencies
 * @param {import("../types.js").UserSettingsRepository} dependencies.userSettingsRepository
 * @param {import("../types.js").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService The installed provider's `auth.service`; it reports the security status.
 */
function createService({ userSettingsRepository, userProfilesRepository, authService }) {
  async function updateNotifications(request, user, payload) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.", { code: "users.profile.notFound" });
    }

    const settings = await userSettingsRepository.updateNotifications(profile.id, payload);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return returnJsonApiData(accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    }));
  }

  return Object.freeze({
    updateNotifications
  });
}

/** @typedef {ReturnType<typeof createService>} AccountNotificationsService */

export { createService };
