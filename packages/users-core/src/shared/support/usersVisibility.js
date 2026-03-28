import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

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

function checkRouteVisibility(value, { context = "checkRouteVisibility" } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (USERS_ROUTE_VISIBILITY_LEVEL_SET.has(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `${context} must be one of: ${USERS_ROUTE_VISIBILITY_LEVELS.join(", ")}.`
  );
}

function isWorkspaceVisibility(visibility = "") {
  const normalized = checkRouteVisibility(visibility, {
    context: "isWorkspaceVisibility visibility"
  });
  return normalized === USERS_ROUTE_VISIBILITY_WORKSPACE || normalized === USERS_ROUTE_VISIBILITY_WORKSPACE_USER;
}

export {
  USERS_ROUTE_VISIBILITY_PUBLIC,
  USERS_ROUTE_VISIBILITY_USER,
  USERS_ROUTE_VISIBILITY_WORKSPACE,
  USERS_ROUTE_VISIBILITY_WORKSPACE_USER,
  USERS_ROUTE_VISIBILITY_LEVELS,
  checkRouteVisibility,
  isWorkspaceVisibility
};
