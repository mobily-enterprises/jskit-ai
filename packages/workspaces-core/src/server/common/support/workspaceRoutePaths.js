import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";

const WORKSPACE_ROUTE_BASE_PATH = resolveScopedApiBasePath({
  routeBase: "/w/:workspaceSlug",
  strictParams: false
});

function resolveWorkspaceRoutePath(relativePath = "/") {
  const normalizedRelativePath = normalizePathname(relativePath || "/");
  if (normalizedRelativePath === "/") {
    return WORKSPACE_ROUTE_BASE_PATH;
  }

  return `${WORKSPACE_ROUTE_BASE_PATH}${normalizedRelativePath}`;
}

export { WORKSPACE_ROUTE_BASE_PATH, resolveWorkspaceRoutePath };
