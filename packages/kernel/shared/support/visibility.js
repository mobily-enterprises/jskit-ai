import { normalizeOpaqueId, normalizeText } from "./normalize.js";
import { ROUTE_VISIBILITY_PUBLIC, ROUTE_VISIBILITY_USER } from "./policies.js";

const ROUTE_VISIBILITY_LEVELS = Object.freeze([ROUTE_VISIBILITY_PUBLIC, ROUTE_VISIBILITY_USER]);
const ROUTE_VISIBILITY_LEVEL_SET = new Set(ROUTE_VISIBILITY_LEVELS);

function normalizeRouteVisibilityToken(value, { fallback = ROUTE_VISIBILITY_PUBLIC } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized) {
    return normalized;
  }

  const normalizedFallback = normalizeText(fallback).toLowerCase();
  if (normalizedFallback) {
    return normalizedFallback;
  }

  return ROUTE_VISIBILITY_PUBLIC;
}

function normalizeRouteVisibility(value, { fallback = ROUTE_VISIBILITY_PUBLIC } = {}) {
  const normalized = normalizeRouteVisibilityToken(value, { fallback });
  if (ROUTE_VISIBILITY_LEVEL_SET.has(normalized)) {
    return normalized;
  }

  const normalizedFallback = normalizeRouteVisibilityToken(fallback, {
    fallback: ROUTE_VISIBILITY_PUBLIC
  });
  if (ROUTE_VISIBILITY_LEVEL_SET.has(normalizedFallback)) {
    return normalizedFallback;
  }

  return ROUTE_VISIBILITY_PUBLIC;
}

function normalizeVisibilityScopeKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || null;
}

function normalizeVisibilityContext(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalizedVisibility = normalizeRouteVisibilityToken(source.visibility);
  const normalizedScopeKind = normalizeVisibilityScopeKind(source.scopeKind);

  return Object.freeze({
    visibility: normalizedVisibility,
    scopeKind: normalizedScopeKind,
    requiresActorScope: source.requiresActorScope === true,
    scopeOwnerId: normalizeOpaqueId(source.scopeOwnerId),
    userOwnerId: normalizeOpaqueId(source.userOwnerId)
  });
}

export { ROUTE_VISIBILITY_LEVELS, normalizeRouteVisibilityToken, normalizeRouteVisibility, normalizeVisibilityContext };
