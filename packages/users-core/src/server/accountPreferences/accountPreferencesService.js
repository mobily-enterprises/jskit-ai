import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createValidationError } from "@jskit-ai/kernel/server/runtime";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../common/formatters/accountSettingsResponseFormatter.js";

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

function createService({
  userSettingsRepository,
  userProfilesRepository,
  authService
} = {}) {
  if (!userSettingsRepository || !userProfilesRepository) {
    throw new Error("accountPreferencesService requires repositories.");
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

  return Object.freeze({
    updatePreferences
  });
}

export { createService };
