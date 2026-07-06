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
  const provider = normalizeAuthProviderId(source.provider || source.authProvider || options.provider, {
    fallback: normalizeAuthProviderId(options.provider, { fallback: "unknown" })
  });
  const providerUserId = normalizeProviderUserId(
    source.providerUserId ||
      source.authProviderUserSid ||
      source.sub ||
      source.userId ||
      source.id
  );
  const email = normalizeEmail(source.email || "");
  const displayName = normalizeDisplayName(source.displayName || source.username || source.name, email);
  const appUserId = normalizeOpaqueId(source.appUserId || source.profileId || source.userProfileId, {
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

function buildLegacyProfileFromActor(actorLike) {
  const actor = normalizeAuthActor(actorLike);
  if (!actor) {
    return null;
  }
  return Object.freeze({
    id: actor.id || actor.appUserId || actor.providerUserId || actor.authIdentityId,
    email: actor.email,
    displayName: actor.displayName,
    authProvider: actor.provider,
    authProviderUserSid: actor.providerUserId
  });
}

function normalizeAuthResult(value = {}, options = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const actor = normalizeAuthActor(source.actor, options) || normalizeAuthActor(source.profile, {
    ...options,
    profileSource: "users"
  });
  const profile = source.profile && typeof source.profile === "object"
    ? source.profile
    : buildLegacyProfileFromActor(actor);

  return Object.freeze({
    ...source,
    ...(actor ? { actor } : {}),
    ...(profile ? { profile } : {})
  });
}

export {
  createAuthIdentityId,
  normalizeAuthActor,
  buildLegacyProfileFromActor,
  normalizeAuthResult
};
