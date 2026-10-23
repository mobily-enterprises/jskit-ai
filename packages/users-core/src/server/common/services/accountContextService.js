import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { isAuthOperationSupported } from "@jskit-ai/auth-core/shared/authCapabilities";
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
  // A provider that keeps passwords elsewhere, such as an accounts hub, has no
  // security status; its settings pages still load.
  if (
    typeof authService.getCapabilities === "function" &&
    !isAuthOperationSupported(authService.getCapabilities(), "getSecurityStatus")
  ) {
    return {};
  }

  return authService.getSecurityStatus(request);
}

export { resolveUserProfile, resolveSecurityStatus };
