import { normalizeIdentity } from "../repositories/userProfilesRepository.js";

async function resolveUserProfile(userProfilesRepository, user) {
  const identity = normalizeIdentity(user);
  if (identity) {
    const profile = await userProfilesRepository.findByIdentity(identity);
    if (profile) {
      return profile;
    }
  }

  const userId = Number(user?.id);
  if (Number.isInteger(userId) && userId > 0) {
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
