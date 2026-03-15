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
    throw new Error("accountProfileService requires repositories.");
  }

  const servicePermissions = Object.freeze({
    getForUser: Object.freeze({
      require: "authenticated"
    }),
    updateProfile: Object.freeze({
      require: "authenticated"
    }),
    uploadAvatar: Object.freeze({
      require: "authenticated"
    }),
    deleteAvatar: Object.freeze({
      require: "authenticated"
    })
  });

  async function getForUser(request, user, options = {}) {
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

  async function updateProfile(request, user, payload = {}, options = {}) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.");
    }

    let session = null;
    let updatedProfile = null;
    if (authService && typeof authService.updateDisplayName === "function") {
      const result = await authService.updateDisplayName(request, payload.displayName);
      session = result?.session || null;
      updatedProfile = result?.profile || null;
    }

    if (!updatedProfile) {
      updatedProfile = await userProfilesRepository.updateDisplayNameById(profile.id, payload.displayName);
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

  async function uploadAvatar(_request, _user, _payload = {}, options = {}) {
    void options;
    throw new AppError(501, "Avatar upload is not implemented in users-core yet.");
  }

  async function deleteAvatar(_request, _user, _payload = {}, options = {}) {
    void options;
    throw new AppError(501, "Avatar deletion is not implemented in users-core yet.");
  }

  return createAuthorizedService(
    {
      getForUser,
      updateProfile,
      uploadAvatar,
      deleteAvatar
    },
    servicePermissions
  );
}

export { createService };
