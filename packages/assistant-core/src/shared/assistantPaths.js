import { normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveApiBasePath } from "@jskit-ai/users-core/shared/support/usersApiPaths";

const ASSISTANT_API_RELATIVE_PATH = "/assistant";
const ASSISTANT_SETTINGS_API_RELATIVE_PATH = "/assistant/settings";
const ASSISTANT_WORKSPACE_API_BASE_PATH_TEMPLATE = "/api/w/:workspaceSlug/assistant";
const ASSISTANT_PUBLIC_API_BASE_PATH = "/api/assistant";
const ASSISTANT_WORKSPACE_SETTINGS_API_PATH_TEMPLATE = "/api/w/:workspaceSlug/assistant/settings";
const ASSISTANT_PUBLIC_SETTINGS_API_PATH = "/api/assistant/settings";

function materializeAssistantPath(basePath = "", workspaceSlug = "", suffix = "/") {
  const normalizedBasePath = String(basePath || "").trim();
  if (!normalizedBasePath) {
    return "";
  }

  const normalizedSuffix = normalizePathname(suffix);
  if (normalizedBasePath.includes(":workspaceSlug")) {
    const normalizedWorkspaceSlug = normalizeText(workspaceSlug).toLowerCase();
    if (!normalizedWorkspaceSlug) {
      return "";
    }

    const materializedBasePath = normalizedBasePath.replace(":workspaceSlug", encodeURIComponent(normalizedWorkspaceSlug));
    return normalizedSuffix === "/" ? materializedBasePath : `${materializedBasePath}${normalizedSuffix}`;
  }

  return normalizedSuffix === "/" ? normalizedBasePath : `${normalizedBasePath}${normalizedSuffix}`;
}

function resolveAssistantApiBasePath({ requiresWorkspace = false } = {}) {
  return resolveApiBasePath({
    surfaceRequiresWorkspace: requiresWorkspace === true,
    relativePath: ASSISTANT_API_RELATIVE_PATH
  });
}

function resolveAssistantSettingsApiPath({ requiresWorkspace = false } = {}) {
  return resolveApiBasePath({
    surfaceRequiresWorkspace: requiresWorkspace === true,
    relativePath: ASSISTANT_SETTINGS_API_RELATIVE_PATH
  });
}

function buildAssistantApiPath({ requiresWorkspace = false, workspaceSlug = "", suffix = "/" } = {}) {
  return materializeAssistantPath(
    resolveAssistantApiBasePath({
      requiresWorkspace
    }),
    workspaceSlug,
    suffix
  );
}

function buildAssistantSettingsApiPath({ requiresWorkspace = false, workspaceSlug = "", suffix = "/" } = {}) {
  return materializeAssistantPath(
    resolveAssistantSettingsApiPath({
      requiresWorkspace
    }),
    workspaceSlug,
    suffix
  );
}

export {
  ASSISTANT_API_RELATIVE_PATH,
  ASSISTANT_SETTINGS_API_RELATIVE_PATH,
  ASSISTANT_WORKSPACE_API_BASE_PATH_TEMPLATE,
  ASSISTANT_PUBLIC_API_BASE_PATH,
  ASSISTANT_WORKSPACE_SETTINGS_API_PATH_TEMPLATE,
  ASSISTANT_PUBLIC_SETTINGS_API_PATH,
  resolveAssistantApiBasePath,
  resolveAssistantSettingsApiPath,
  buildAssistantApiPath,
  buildAssistantSettingsApiPath
};
