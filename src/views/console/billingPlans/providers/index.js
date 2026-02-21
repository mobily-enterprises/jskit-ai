import { defaultProviderProfile } from "./defaultProviderProfile.js";
import { stripeProviderProfile } from "./stripeProviderProfile.js";

const PROVIDER_PROFILE_MAP = Object.freeze({
  stripe: stripeProviderProfile
});

function resolveBillingPlanProviderProfile(provider) {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  return PROVIDER_PROFILE_MAP[normalizedProvider] || defaultProviderProfile;
}

export { resolveBillingPlanProviderProfile };
