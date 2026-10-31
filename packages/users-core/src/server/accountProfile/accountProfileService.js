import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import {
  resolveUserProfile,
  resolveSecurityStatus
} from "../common/services/accountContextService.js";
import {
  accountSettingsResponseFormatter
} from "../common/formatters/accountSettingsResponseFormatter.js";

/** @typedef {ReturnType<typeof import("../common/repositories/userProfilesRepository.js").createRepository>} UserProfilesRepository */
/** @typedef {ReturnType<typeof import("../common/repositories/userSettingsRepository.js").createRepository>} UserSettingsRepository */

// A signed-in user's profile: display name and avatar.
/**
 * @param {object} dependencies
 * @param {UserSettingsRepository} dependencies.userSettingsRepository
 * @param {UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService The installed provider's `auth.service`; it may keep the display name itself.
 * @param {import("./avatarService.js").AvatarService} dependencies.avatarService
 */
function createService({ userSettingsRepository, userProfilesRepository, authService, avatarService }) {

  async function getForUser(request, user, options = {}) {
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

  async function updateProfile(request, user, payload, options = {}) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.", { code: "users.profile.notFound" });
    }

    let session = null;
    let updatedProfile = null;
    // readable-check: allow method-probe - updateDisplayName is an optional auth.service operation
    if (typeof authService.updateDisplayName === "function") {
      const result = await authService.updateDisplayName(request, { displayName: payload.displayName });
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
      response: returnJsonApiData(accountSettingsResponseFormatter({
        profile: updatedProfile,
        settings,
        securityStatus,
        authService
      }))
    };
  }

  async function uploadAvatar(request, user, avatarUpload = {}, options = {}) {
    void options;

    const result = await avatarService.uploadForUser(user, avatarUpload);
    const profile = result?.profile || null;
    if (!profile) {
      throw new AppError(500, "Avatar upload completed without a profile result.", {
        code: "users.avatar.uploadResultMissing"
      });
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

  async function deleteAvatar(request, user, options = {}) {
    void options;

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

  async function readAvatar(_request, user, options = {}) {
    void options;

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

/** @typedef {ReturnType<typeof createService>} AccountProfileService */

export { createService };
