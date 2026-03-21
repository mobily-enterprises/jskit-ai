import {
  USERS_WORKSPACE_API_BASE_PATH,
  normalizeApiRelativePath
} from "../../../shared/support/usersApiPaths.js";

const USERS_WORKSPACE_ROUTE_BASE_PATH = USERS_WORKSPACE_API_BASE_PATH;

function resolveWorkspaceRoutePath(relativePath = "/") {
  const normalizedRelativePath = normalizeApiRelativePath(relativePath);
  if (normalizedRelativePath === "/") {
    return USERS_WORKSPACE_ROUTE_BASE_PATH;
  }

  return `${USERS_WORKSPACE_ROUTE_BASE_PATH}${normalizedRelativePath}`;
}

export { USERS_WORKSPACE_ROUTE_BASE_PATH, resolveWorkspaceRoutePath };
