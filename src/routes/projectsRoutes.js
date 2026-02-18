import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const ProjectsListView = lazyRouteComponent(() => import("../views/projects/ProjectsList.vue"));
const ProjectsAddView = lazyRouteComponent(() => import("../views/projects/ProjectsAdd.vue"));
const ProjectsView = lazyRouteComponent(() => import("../views/projects/ProjectsView.vue"));
const ProjectsEditView = lazyRouteComponent(() => import("../views/projects/ProjectsEdit.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function createRoutes({ rootRoute, workspaceRoutePrefix, guards }) {
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/projects`,
      component: ProjectsListView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.read"])
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/projects/add`,
      component: ProjectsAddView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.write"])
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/projects/$projectId/edit`,
      component: ProjectsEditView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.write"])
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/projects/$projectId`,
      component: ProjectsView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.read"])
    })
  ];
}

export { createRoutes };
