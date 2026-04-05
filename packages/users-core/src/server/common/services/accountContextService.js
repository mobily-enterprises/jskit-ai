import { normalizeIdentity } from "../repositories/usersRepository.js";

async function resolveUserProfile(usersRepository, user) {
  const identity = normalizeIdentity(user);
  if (identity) {
    const profile = await usersRepository.findByIdentity(identity);
    if (profile) {
      return profile;
    }
  }

  const userId = Number(user?.id);
  if (Number.isInteger(userId) && userId > 0) {
    const profileById = await usersRepository.findById(userId);
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
