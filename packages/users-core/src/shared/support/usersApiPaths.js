import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";

const USERS_PUBLIC_API_BASE_PATH = "/api";
const USERS_WORKSPACE_API_BASE_PATH = "/api/w/:workspaceSlug/workspace";

function normalizeApiRelativePath(relativePath = "/") {
  const normalizedPath = normalizePathname(relativePath);
  return normalizedPath || "/";
}

function normalizeSurfaceWorkspaceRequirement(value = false) {
  return value === true;
}

function resolveApiBasePath({ surfaceRequiresWorkspace = false, relativePath = "/" } = {}) {
  const basePath = normalizeSurfaceWorkspaceRequirement(surfaceRequiresWorkspace)
    ? USERS_WORKSPACE_API_BASE_PATH
    : USERS_PUBLIC_API_BASE_PATH;
  const normalizedRelativePath = normalizeApiRelativePath(relativePath);

  if (normalizedRelativePath === "/") {
    return basePath;
  }

  return `${basePath}${normalizedRelativePath}`;
}

export {
  USERS_PUBLIC_API_BASE_PATH,
  USERS_WORKSPACE_API_BASE_PATH,
  normalizeApiRelativePath,
  normalizeSurfaceWorkspaceRequirement,
  resolveApiBasePath
};
