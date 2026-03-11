import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createValidationError } from "@jskit-ai/kernel/server/runtime";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
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
    throw new Error("accountProfileService requires repositories.");
  }

  async function getForUser(request, user) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    });
  }

  async function updateProfile(request, user, payload = {}) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
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
    const securityStatus = await resolveSecurityStatus(authService, request);

    return {
      session,
      settings: accountSettingsResponseFormatter({
        profile: updatedProfile,
        settings,
        securityStatus,
        authService
      })
    };
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
    uploadAvatar,
    deleteAvatar
  });
}

export { createService };
