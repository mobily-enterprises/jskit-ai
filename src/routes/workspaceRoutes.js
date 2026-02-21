import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const WorkspaceSettingsView = lazyRouteComponent(() => import("../views/workspace-settings/WorkspaceSettingsView.vue"));
const WorkspaceTranscriptsView = lazyRouteComponent(() => import("../views/workspace-transcripts/WorkspaceTranscriptsView.vue"));
const WorkspaceBillingView = lazyRouteComponent(() => import("../views/workspace-billing/WorkspaceBillingView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function createRoutes({ rootRoute, workspaceRoutePrefix, guards }) {
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/settings`,
      component: WorkspaceSettingsView,
      beforeLoad: (context) =>
        guards.beforeLoadWorkspacePermissionsRequired(context, ["workspace.settings.view", "workspace.settings.update"])
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/transcripts`,
      component: WorkspaceTranscriptsView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, "workspace.ai.transcripts.read")
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/billing`,
      component: WorkspaceBillingView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, "workspace.billing.manage")
    })
  ];
}

export { createRoutes };
