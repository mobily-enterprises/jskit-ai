import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../common/formatters/accountSettingsResponseFormatter.js";

function createService({
  userSettingsRepository,
  usersRepository,
  authService
} = {}) {
  if (!userSettingsRepository || !usersRepository) {
    throw new Error("accountPreferencesService requires repositories.");
  }

  async function updatePreferences(request, user, payload = {}, options = {}) {
    const profile = await resolveUserProfile(usersRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const settings = await userSettingsRepository.updatePreferences(profile.id, payload);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    });
  }

  return Object.freeze({
    updatePreferences
  });
}

export { createService };
