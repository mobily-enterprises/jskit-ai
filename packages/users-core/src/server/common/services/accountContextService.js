import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeIdentity } from "../support/identity.js";

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

async function resolveSecurityStatus(authService, request) {
  if (!authService || typeof authService.getSecurityStatus !== "function") {
    return {};
  }

  return authService.getSecurityStatus(request);
}

export { resolveUserProfile, resolveSecurityStatus };
