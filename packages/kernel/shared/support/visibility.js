import { normalizeOpaqueId, normalizeText } from "./normalize.js";

const ROUTE_VISIBILITY_LEVELS = Object.freeze(["public", "user"]);
const ROUTE_VISIBILITY_LEVEL_SET = new Set(ROUTE_VISIBILITY_LEVELS);

function normalizeRouteVisibilityToken(value, { fallback = "public" } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized) {
    return normalized;
  }

  const normalizedFallback = normalizeText(fallback).toLowerCase();
  if (normalizedFallback) {
    return normalizedFallback;
  }

  return "public";
}

function normalizeRouteVisibility(value, { fallback = "public" } = {}) {
  const normalized = normalizeRouteVisibilityToken(value, { fallback });
  if (ROUTE_VISIBILITY_LEVEL_SET.has(normalized)) {
    return normalized;
  }

  const normalizedFallback = normalizeRouteVisibilityToken(fallback, {
    fallback: "public"
  });
  if (ROUTE_VISIBILITY_LEVEL_SET.has(normalizedFallback)) {
    return normalizedFallback;
  }

  return "public";
}

function normalizeScopeKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || null;
}

function normalizeVisibilityContext(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalizedVisibility = normalizeRouteVisibilityToken(source.visibility);
  const normalizedScopeKind = normalizeScopeKind(source.scopeKind);

  return Object.freeze({
    visibility: normalizedVisibility,
    scopeKind: normalizedScopeKind,
    requiresActorScope: source.requiresActorScope === true,
    scopeOwnerId: normalizeOpaqueId(source.scopeOwnerId),
    userOwnerId: normalizeOpaqueId(source.userOwnerId)
  });
}

export { ROUTE_VISIBILITY_LEVELS, normalizeRouteVisibilityToken, normalizeRouteVisibility, normalizeVisibilityContext };
