import { inject } from "vue";

/** workspaces-web provides its route scope under this key in an application with workspaces. */
const WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY = "jskit.workspaces.web.scope-support";

const EMPTY_ROUTE_SCOPE = Object.freeze({
  workspaceSlug: ""
});

/**
 * An application without workspaces: no route names a workspace.
 * @type {import("../types.js").WorkspaceScopeSupport}
 */
const NO_WORKSPACE_WEB_SCOPE_SUPPORT = Object.freeze({
  available: false,
  readRouteScope() {
    return EMPTY_ROUTE_SCOPE;
  }
});

/**
 * The application's workspace route scope, or none when it has no workspaces.
 * @returns {import("../types.js").WorkspaceScopeSupport}
 */
function useWorkspaceWebScopeSupport() {
  return inject(WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY, NO_WORKSPACE_WEB_SCOPE_SUPPORT);
}

export { useWorkspaceWebScopeSupport };
