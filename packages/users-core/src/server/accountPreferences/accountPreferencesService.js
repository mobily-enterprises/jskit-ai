import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../common/formatters/accountSettingsResponseFormatter.js";

// A signed-in user's display and regional preferences.
/**
 * @param {object} dependencies
 * @param {import("../types.js").UserSettingsRepository} dependencies.userSettingsRepository
 * @param {import("../types.js").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService The installed provider's `auth.service`; it reports the security status.
 */
function createService({ userSettingsRepository, userProfilesRepository, authService }) {
  // Saves the validated preference fields and answers with the account's settings.
  async function updatePreferences(request, user, payload) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.", { code: "users.profile.notFound" });
    }

    const settings = await userSettingsRepository.updatePreferences(profile.id, payload);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return returnJsonApiData(accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    }));
  }

  return Object.freeze({
    updatePreferences
  });
}

/** @typedef {ReturnType<typeof createService>} AccountPreferencesService */

export { createService };
