import { normalizeSchemaDefinition } from "@jskit-ai/kernel/shared/validators";

const WORKSPACES_SERVER_SCOPE_SUPPORT_TOKEN = "workspaces.server.scope-support";

function hasWorkspaceRouteParamsDefinition(value) {
  try {
    return Boolean(normalizeSchemaDefinition(value, {
      context: "assistant-runtime workspace scope support.params",
      defaultMode: "patch"
    }));
  } catch {
    return false;
  }
}

function isWorkspaceServerScopeSupport(value) {
  return Boolean(
    value &&
      value.available === true &&
      hasWorkspaceRouteParamsDefinition(value.params) &&
      typeof value.buildInputFromRouteParams === "function" &&
      typeof value.resolveWorkspace === "function"
  );
}

function resolveWorkspaceServerScopeSupport(scope = null, { required = false, caller = "assistant-runtime" } = {}) {
  const support =
    scope && typeof scope.has === "function" && typeof scope.make === "function" && scope.has(WORKSPACES_SERVER_SCOPE_SUPPORT_TOKEN)
      ? scope.make(WORKSPACES_SERVER_SCOPE_SUPPORT_TOKEN)
      : null;

  if (isWorkspaceServerScopeSupport(support)) {
    return support;
  }

  if (required) {
    throw new Error(`${caller} requires ${WORKSPACES_SERVER_SCOPE_SUPPORT_TOKEN} for workspace-scoped assistant surfaces.`);
  }

  return null;
}

export {
  WORKSPACES_SERVER_SCOPE_SUPPORT_TOKEN,
  isWorkspaceServerScopeSupport,
  resolveWorkspaceServerScopeSupport
};
