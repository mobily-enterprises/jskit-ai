import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";
import { splitPathQueryAndHash } from "@jskit-ai/kernel/shared/support";

const USERS_PUBLIC_API_BASE_PATH = "/api";
const USERS_WORKSPACE_API_BASE_PATH = "/api/w/:workspaceSlug";

function normalizeApiRelativePath(relativePath = "/") {
  const { pathname, queryString, hash } = splitPathQueryAndHash(relativePath);
  const normalizedPath = normalizePathname(pathname || "/") || "/";
  const normalizedQueryString = String(queryString || "").trim().replace(/^\?+/, "");
  const normalizedHash = String(hash || "").trim();
  const querySuffix = normalizedQueryString ? `?${normalizedQueryString}` : "";
  return `${normalizedPath}${querySuffix}${normalizedHash}`;
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

  if (normalizedRelativePath.startsWith("/?") || normalizedRelativePath.startsWith("/#")) {
    return `${basePath}${normalizedRelativePath.slice(1)}`;
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
