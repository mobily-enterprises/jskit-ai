import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { isAuthOperationSupported } from "@jskit-ai/auth-core/shared/authCapabilities";
import { normalizeIdentity } from "../support/identity.js";

/**
 * @param {import("../../types.js").UserProfilesRepository} userProfilesRepository
 * @param {object} user
 */
async function resolveUserProfile(userProfilesRepository, user) {
  const identity = normalizeIdentity(user);
  if (identity) {
    const profile = await userProfilesRepository.findByIdentity(identity);
    if (profile) {
      return profile;
    }
  }

  const userId = normalizeRecordId(user?.id, { fallback: null });
  if (userId) {
    const profileById = await userProfilesRepository.findById(userId);
    if (profileById) {
      return profileById;
    }
  }

  return null;
}

/**
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} authService
 * @param {object} request
 */
async function resolveSecurityStatus(authService, request) {
  // readable-check: allow method-probe - getSecurityStatus is an optional auth.service operation
  if (typeof authService.getSecurityStatus !== "function") {
    return {};
  }
  // A provider that keeps passwords elsewhere, such as an accounts hub, has no
  // security status; its settings pages still load.
  if (!isAuthOperationSupported(authService.getCapabilities(), "getSecurityStatus")) {
    return {};
  }

  return authService.getSecurityStatus(request);
}

export { resolveUserProfile, resolveSecurityStatus };
