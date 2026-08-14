import { normalizeOpaqueId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeAuthProviderId } from "../shared/authCapabilities.js";
import { normalizeEmail } from "./utils.js";

function normalizeDisplayName(value, email = "") {
  const displayName = String(value || "").trim();
  if (displayName) {
    return displayName;
  }
  const localPart = String(email || "").split("@")[0]?.trim();
  return localPart || "User";
}

function normalizeProviderUserId(value) {
  return String(value || "").trim();
}

function createAuthIdentityId(provider, providerUserId) {
  if (!provider || !providerUserId) {
    return "";
  }
  return `${provider}:${providerUserId}`;
}

function normalizeAuthActor(value = {}, options = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const provider = normalizeAuthProviderId(source.provider || options.provider, {
    fallback: normalizeAuthProviderId(options.provider, { fallback: "unknown" })
  });
  const providerUserId = normalizeProviderUserId(source.providerUserId);
  const email = normalizeEmail(source.email || "");
  const displayName = normalizeDisplayName(source.displayName, email);
  const appUserId = normalizeOpaqueId(source.appUserId, {
    fallback: null
  });
  const id = appUserId || providerUserId;
  const authIdentityId = String(source.authIdentityId || createAuthIdentityId(provider, providerUserId)).trim();

  if (!providerUserId || !email) {
    return null;
  }

  return Object.freeze({
    id,
    authIdentityId,
    provider,
    providerUserId,
    email,
    displayName,
    appUserId,
    profileSource: String(source.profileSource || options.profileSource || "auth-provider").trim() || "auth-provider"
  });
}

function normalizeAuthResult(value = {}, options = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const actor = normalizeAuthActor(source.actor, options);
  const { profile: _profile, ...result } = source;

  return Object.freeze({
    ...result,
    ...(actor ? { actor } : {})
  });
}

export {
  createAuthIdentityId,
  normalizeAuthActor,
  normalizeAuthResult
};
