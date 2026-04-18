import { normalizeObject, normalizeOpaqueId, normalizeText } from "./normalize.js";
import { ROUTE_VISIBILITY_PUBLIC, ROUTE_VISIBILITY_USER } from "./policies.js";

const ROUTE_VISIBILITY_LEVELS = Object.freeze([ROUTE_VISIBILITY_PUBLIC, ROUTE_VISIBILITY_USER]);
const ROUTE_VISIBILITY_LEVEL_SET = new Set(ROUTE_VISIBILITY_LEVELS);
const ROUTE_VISIBILITY_WORKSPACE = "workspace";
const ROUTE_VISIBILITY_WORKSPACE_USER = "workspace_user";
const ROUTE_VISIBILITY_TOKENS = Object.freeze([
  ROUTE_VISIBILITY_PUBLIC,
  ROUTE_VISIBILITY_USER,
  ROUTE_VISIBILITY_WORKSPACE,
  ROUTE_VISIBILITY_WORKSPACE_USER
]);
const ROUTE_VISIBILITY_TOKEN_SET = new Set(ROUTE_VISIBILITY_TOKENS);

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

function checkRouteVisibility(value, { context = "checkRouteVisibility" } = {}) {
  const normalized = normalizeRouteVisibilityToken(value);
  if (ROUTE_VISIBILITY_TOKEN_SET.has(normalized)) {
    return normalized;
  }

  throw new TypeError(`${context} must be one of: ${ROUTE_VISIBILITY_TOKENS.join(", ")}.`);
}

function isWorkspaceRouteVisibility(value = "") {
  const normalized = checkRouteVisibility(value, {
    context: "isWorkspaceRouteVisibility visibility"
  });
  return normalized === ROUTE_VISIBILITY_WORKSPACE || normalized === ROUTE_VISIBILITY_WORKSPACE_USER;
}

function normalizeVisibilityScopeKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || null;
}

function normalizeVisibilityContext(value = {}) {
  const source = normalizeObject(value);
  const normalizedVisibility = normalizeRouteVisibilityToken(source.visibility);
  const normalizedScopeKind = normalizeVisibilityScopeKind(source.scopeKind);

  return Object.freeze({
    visibility: normalizedVisibility,
    scopeKind: normalizedScopeKind,
    requiresActorScope: source.requiresActorScope === true,
    scopeOwnerId: normalizeOpaqueId(source.scopeOwnerId),
    userId: normalizeOpaqueId(source.userId)
  });
}

export {
  ROUTE_VISIBILITY_LEVELS,
  ROUTE_VISIBILITY_PUBLIC,
  ROUTE_VISIBILITY_USER,
  ROUTE_VISIBILITY_WORKSPACE,
  ROUTE_VISIBILITY_WORKSPACE_USER,
  ROUTE_VISIBILITY_TOKENS,
  normalizeRouteVisibilityToken,
  normalizeRouteVisibility,
  checkRouteVisibility,
  isWorkspaceRouteVisibility,
  normalizeVisibilityContext
};
