import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";
import { normalizeScopedRouteVisibility } from "@jskit-ai/users-core/shared/support/usersVisibility";

const ASSISTANT_API_RELATIVE_PATH = "/assistant";
const ASSISTANT_WORKSPACE_API_BASE_PATH_TEMPLATE = "/api/w/:workspaceSlug/assistant";
const ASSISTANT_PUBLIC_API_BASE_PATH = `/api${ASSISTANT_API_RELATIVE_PATH}`;

function resolveAssistantApiBasePath({ visibility = "workspace" } = {}) {
  const normalizedVisibility = normalizeScopedRouteVisibility(visibility, {
    fallback: "workspace"
  });
  if (normalizedVisibility === "workspace" || normalizedVisibility === "workspace_user") {
    return ASSISTANT_WORKSPACE_API_BASE_PATH_TEMPLATE;
  }

  return ASSISTANT_PUBLIC_API_BASE_PATH;
}

function resolveAssistantWorkspaceApiBasePath(workspaceSlug = "") {
  const normalizedWorkspaceSlug = normalizeText(workspaceSlug).toLowerCase();
  if (!normalizedWorkspaceSlug) {
    return "";
  }

  return `/api/w/${encodeURIComponent(normalizedWorkspaceSlug)}${ASSISTANT_API_RELATIVE_PATH}`;
}

function buildAssistantWorkspaceApiPath(workspaceSlug = "", suffix = "/") {
  const basePath = resolveAssistantWorkspaceApiBasePath(workspaceSlug);
  if (!basePath) {
    return "";
  }

  const normalizedSuffix = normalizePathname(suffix);
  if (normalizedSuffix === "/") {
    return basePath;
  }

  return `${basePath}${normalizedSuffix}`;
}

export {
  ASSISTANT_API_RELATIVE_PATH,
  ASSISTANT_WORKSPACE_API_BASE_PATH_TEMPLATE,
  ASSISTANT_PUBLIC_API_BASE_PATH,
  resolveAssistantApiBasePath,
  resolveAssistantWorkspaceApiBasePath,
  buildAssistantWorkspaceApiPath
};
