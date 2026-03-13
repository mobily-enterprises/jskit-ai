import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";

const USERS_PUBLIC_API_BASE_PATH = "/api";
const USERS_WORKSPACE_API_BASE_PATH = "/api/w/:workspaceSlug/workspace";

function isWorkspaceVisibility(visibility = "") {
  const normalizedVisibility = normalizeRouteVisibility(visibility, {
    fallback: "public"
  });
  return normalizedVisibility === "workspace" || normalizedVisibility === "workspace_user";
}

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
