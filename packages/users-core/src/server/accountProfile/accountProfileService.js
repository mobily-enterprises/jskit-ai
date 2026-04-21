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
  userProfilesRepository,
  authService,
  avatarService
} = {}) {
  if (!userSettingsRepository || !userProfilesRepository || !avatarService) {
    throw new Error("accountProfileService requires repositories and avatarService.");
  }

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

  async function uploadAvatar(request, user, avatarUpload = {}, options = {}) {
    void options;

    const result = await avatarService.uploadForUser(user, avatarUpload);
    const profile = result?.profile || null;
    if (!profile) {
      throw new AppError(500, "Avatar upload completed without a profile result.");
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

  async function deleteAvatar(request, user, options = {}) {
    void options;

    const profile = await avatarService.clearForUser(user);
    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    });
  }

  async function readAvatar(_request, user, options = {}) {
    void options;

    const avatar = await avatarService.readForUser(user);
    if (!avatar) {
      throw new AppError(404, "Avatar not found.");
    }

    return avatar;
  }

  return Object.freeze({
    getForUser,
    updateProfile,
    uploadAvatar,
    deleteAvatar,
    readAvatar
  });
}

export { createService };
