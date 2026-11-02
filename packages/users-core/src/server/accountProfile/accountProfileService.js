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
 * A signed-in user's profile: display name and avatar.
 * @param {object} dependencies
 * @param {import("../types.js").UserSettingsRepository} dependencies.userSettingsRepository
 * @param {import("../types.js").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService The installed provider's `auth.service`; it may keep the display name itself.
 * @param {import("../types.js").AvatarService} dependencies.avatarService
 */
function createService({ userSettingsRepository, userProfilesRepository, authService, avatarService }) {
  async function getForUser(request, user) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.", { code: "users.profile.notFound" });
    }

    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return returnJsonApiData(accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    }));
  }

  async function updateProfile(request, user, payload) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.", { code: "users.profile.notFound" });
    }

    const result = await authService.updateDisplayName(request, { displayName: payload.displayName });
    const session = result?.session || null;
    const updatedProfile =
      result?.profile || (await userProfilesRepository.updateDisplayNameById(profile.id, payload.displayName));

    const settings = await userSettingsRepository.ensureForUserId(updatedProfile.id);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return {
      session,
      response: returnJsonApiData(accountSettingsResponseFormatter({
        profile: updatedProfile,
        settings,
        securityStatus,
        authService
      }))
    };
  }

  async function uploadAvatar(request, user, avatarUpload) {
    const result = await avatarService.uploadForUser(user, avatarUpload);
    const profile = result?.profile || null;
    if (!profile) {
      throw new Error("Avatar upload completed without a profile result.");
    }

    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return returnJsonApiData(accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    }));
  }

  async function deleteAvatar(request, user) {
    const profile = await avatarService.clearForUser(user);
    const settings = await userSettingsRepository.ensureForUserId(profile.id);
    const securityStatus = await resolveSecurityStatus(authService, request);

    return returnJsonApiData(accountSettingsResponseFormatter({
      profile,
      settings,
      securityStatus,
      authService
    }));
  }

  async function readAvatar(user) {
    const avatar = await avatarService.readForUser(user);
    if (!avatar) {
      throw new AppError(404, "Avatar not found.", { code: "users.avatar.notFound" });
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
