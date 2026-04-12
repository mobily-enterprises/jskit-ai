import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeIdentity } from "../repositories/usersRepository.js";

async function resolveUserProfile(usersRepository, user) {
  const identity = normalizeIdentity(user);
  if (identity) {
    const profile = await usersRepository.findByIdentity(identity);
    if (profile) {
      return profile;
    }
  }

  const userId = normalizeRecordId(user?.id, { fallback: null });
  if (userId) {
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
