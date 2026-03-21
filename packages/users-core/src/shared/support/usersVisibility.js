import { normalizeRouteVisibilityToken } from "@jskit-ai/kernel/shared/support/visibility";

const USERS_ROUTE_VISIBILITY_PUBLIC = "public";
const USERS_ROUTE_VISIBILITY_USER = "user";
const USERS_ROUTE_VISIBILITY_WORKSPACE = "workspace";
const USERS_ROUTE_VISIBILITY_WORKSPACE_USER = "workspace_user";

const USERS_ROUTE_VISIBILITY_LEVELS = Object.freeze([
  USERS_ROUTE_VISIBILITY_PUBLIC,
  USERS_ROUTE_VISIBILITY_USER,
  USERS_ROUTE_VISIBILITY_WORKSPACE,
  USERS_ROUTE_VISIBILITY_WORKSPACE_USER
]);
const USERS_ROUTE_VISIBILITY_LEVEL_SET = new Set(USERS_ROUTE_VISIBILITY_LEVELS);

function normalizeScopedRouteVisibility(value, { fallback = USERS_ROUTE_VISIBILITY_PUBLIC } = {}) {
  const normalized = normalizeRouteVisibilityToken(value, { fallback: USERS_ROUTE_VISIBILITY_PUBLIC });
  if (USERS_ROUTE_VISIBILITY_LEVEL_SET.has(normalized)) {
    return normalized;
  }

  const normalizedFallback = normalizeRouteVisibilityToken(fallback, { fallback: USERS_ROUTE_VISIBILITY_PUBLIC });
  if (USERS_ROUTE_VISIBILITY_LEVEL_SET.has(normalizedFallback)) {
    return normalizedFallback;
  }

  return USERS_ROUTE_VISIBILITY_PUBLIC;
}

function isWorkspaceVisibility(visibility = "") {
  const normalized = normalizeScopedRouteVisibility(visibility, {
    fallback: USERS_ROUTE_VISIBILITY_PUBLIC
  });
  return normalized === USERS_ROUTE_VISIBILITY_WORKSPACE || normalized === USERS_ROUTE_VISIBILITY_WORKSPACE_USER;
}

export {
  USERS_ROUTE_VISIBILITY_PUBLIC,
  USERS_ROUTE_VISIBILITY_USER,
  USERS_ROUTE_VISIBILITY_WORKSPACE,
  USERS_ROUTE_VISIBILITY_WORKSPACE_USER,
  USERS_ROUTE_VISIBILITY_LEVELS,
  normalizeScopedRouteVisibility,
  isWorkspaceVisibility
};
