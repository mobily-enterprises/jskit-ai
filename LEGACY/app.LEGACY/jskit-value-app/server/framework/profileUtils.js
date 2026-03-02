import { FRAMEWORK_PROFILE_IDS } from "../../shared/framework/profile.js";

function normalizeProfileId(profileId) {
  const normalized = String(profileId || FRAMEWORK_PROFILE_IDS.webSaasDefault).trim();
  return normalized || FRAMEWORK_PROFILE_IDS.webSaasDefault;
}

export { normalizeProfileId };
