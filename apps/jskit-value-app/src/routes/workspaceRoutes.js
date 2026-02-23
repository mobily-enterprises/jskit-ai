import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const WorkspaceSettingsView = lazyRouteComponent(() => import("../views/workspace-settings/WorkspaceSettingsView.vue"));
const WorkspaceMonitoringView = lazyRouteComponent(
  () => import("../views/workspace-admin/WorkspaceMonitoringView.vue")
);
const WorkspaceMembersView = lazyRouteComponent(() => import("../views/workspace-admin/WorkspaceMembersView.vue"));
const WorkspaceTranscriptsView = lazyRouteComponent(
  () => import("../views/workspace-transcripts/WorkspaceTranscriptsView.vue")
);
const WorkspaceBillingView = lazyRouteComponent(() => import("../views/workspace-billing/WorkspaceBillingView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

const WORKSPACE_MONITORING_PERMISSIONS = ["workspace.billing.manage", "workspace.ai.transcripts.read"];
const WORKSPACE_MEMBERS_PERMISSIONS = [
  "workspace.members.view",
  "workspace.members.invite",
  "workspace.members.manage",
  "workspace.invites.revoke"
];

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
      path: `${workspaceRoutePrefix}/admin`,
      component: WorkspaceMonitoringView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, WORKSPACE_MONITORING_PERMISSIONS)
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/admin/billing`,
      component: WorkspaceBillingView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, "workspace.billing.manage")
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/admin/members`,
      component: WorkspaceMembersView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, WORKSPACE_MEMBERS_PERMISSIONS)
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/admin/monitoring`,
      component: WorkspaceMonitoringView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, WORKSPACE_MONITORING_PERMISSIONS)
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/admin/monitoring/transcripts`,
      component: WorkspaceMonitoringView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, "workspace.ai.transcripts.read")
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/admin/monitoring/audit-activity`,
      component: WorkspaceMonitoringView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, WORKSPACE_MONITORING_PERMISSIONS)
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
