import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const WorkspaceSettingsView = lazyRouteComponent(() => import("../views/workspace-settings/WorkspaceSettingsView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function createWorkspaceRoutes({ rootRoute, workspaceRoutePrefix, guards }) {
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/settings`,
      component: WorkspaceSettingsView,
      beforeLoad: (context) =>
        guards.beforeLoadWorkspacePermissionsRequired(context, ["workspace.settings.view", "workspace.settings.update"])
    })
  ];
}

export { createWorkspaceRoutes };
