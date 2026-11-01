import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { DEFAULT_IMAGE_UPLOAD_POLICY } from "@jskit-ai/uploads-runtime/shared";
import { readUploadBuffer, validateUploadMimeType } from "@jskit-ai/uploads-runtime/server/policy/uploadPolicy";
import { resolveUserProfile } from "../common/services/accountContextService.js";

/**
 * Avatars are images within uploads-runtime's default image upload policy.
 * @param {object} dependencies
 * @param {import("../types.js").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("../types.js").AvatarStorageService} dependencies.avatarStorageService
 */
function createService({ userProfilesRepository, avatarStorageService }) {
  async function resolveProfile(user) {
    const profile = await resolveUserProfile(userProfilesRepository, user);
    if (!profile) {
      throw new AppError(404, "User profile was not found.", { code: "users.profile.notFound" });
    }
    return profile;
  }

  async function uploadForUser(user, avatarUpload) {
    const profile = await resolveProfile(user);
    validateUploadMimeType(avatarUpload.mimeType, DEFAULT_IMAGE_UPLOAD_POLICY, {
      fieldName: "avatar",
      label: "Avatar"
    });

    const buffer = await readUploadBuffer(avatarUpload.stream, {
      maxBytes: DEFAULT_IMAGE_UPLOAD_POLICY.maxUploadBytes,
      fieldName: "avatar",
      label: "Avatar"
    });

    const avatarVersionMs = Date.now();
    const avatarVersion = String(avatarVersionMs);
    const savedAvatar = await avatarStorageService.saveAvatar({
      userId: profile.id,
      buffer
    });

    const updatedProfile = await userProfilesRepository.updateAvatarById(profile.id, {
      avatarStorageKey: savedAvatar.storageKey,
      avatarVersion,
      avatarUpdatedAt: new Date(avatarVersionMs)
    });

    return Object.freeze({
      profile: updatedProfile
    });
  }

  async function clearForUser(user) {
    const profile = await resolveProfile(user);
    if (profile.avatarStorageKey) {
      await avatarStorageService.deleteAvatar(profile.avatarStorageKey);
    }
    return userProfilesRepository.clearAvatarById(profile.id);
  }

  async function readForUser(user) {
    const profile = await resolveProfile(user);
    if (!profile.avatarStorageKey) {
      return null;
    }

    return avatarStorageService.readAvatar(profile.avatarStorageKey);
  }

  return Object.freeze({
    uploadForUser,
    clearForUser,
    readForUser
  });
}

export { createService };
