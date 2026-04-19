import { inject } from "vue";

const WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY = "jskit.workspaces.web.scope-support";

const EMPTY_ROUTE_SCOPE = Object.freeze({
  workspaceSlug: ""
});

const EMPTY_WORKSPACE_WEB_SCOPE_SUPPORT = Object.freeze({
  available: false,
  readRouteScope() {
    return EMPTY_ROUTE_SCOPE;
  }
});

function isWorkspaceWebScopeSupport(value) {
  return Boolean(value && typeof value.readRouteScope === "function");
}

function useWorkspaceWebScopeSupport({ required = false } = {}) {
  const support = inject(WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY, null);
  if (isWorkspaceWebScopeSupport(support)) {
    return support;
  }

  if (required) {
    throw new Error("Workspace web scope support is not available in Vue injection context.");
  }

  return EMPTY_WORKSPACE_WEB_SCOPE_SUPPORT;
}

export {
  EMPTY_WORKSPACE_WEB_SCOPE_SUPPORT,
  WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY,
  isWorkspaceWebScopeSupport,
  useWorkspaceWebScopeSupport
};
