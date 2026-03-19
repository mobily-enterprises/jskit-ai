import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";
import { isWorkspaceVisibility } from "./usersVisibility.js";

const USERS_PUBLIC_API_BASE_PATH = "/api";
const USERS_WORKSPACE_API_BASE_PATH = "/api/w/:workspaceSlug/workspace";

function normalizeUsersApiRelativePath(relativePath = "/") {
  const normalizedPath = normalizePathname(relativePath);
  return normalizedPath || "/";
}

function resolveUsersApiBasePath({ visibility = "public", relativePath = "/" } = {}) {
  const basePath = isWorkspaceVisibility(visibility)
    ? USERS_WORKSPACE_API_BASE_PATH
    : USERS_PUBLIC_API_BASE_PATH;
  const normalizedRelativePath = normalizeUsersApiRelativePath(relativePath);

  if (normalizedRelativePath === "/") {
    return basePath;
  }

  return `${basePath}${normalizedRelativePath}`;
}

export {
  USERS_PUBLIC_API_BASE_PATH,
  USERS_WORKSPACE_API_BASE_PATH,
  isWorkspaceVisibility,
  normalizeUsersApiRelativePath,
  resolveUsersApiBasePath
};
