import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const ProjectsListView = lazyRouteComponent(() => import("../../../views/projects/ProjectsList.vue"));
const ProjectsAddView = lazyRouteComponent(() => import("../../../views/projects/ProjectsAdd.vue"));
const ProjectsView = lazyRouteComponent(() => import("../../../views/projects/ProjectsView.vue"));
const ProjectsEditView = lazyRouteComponent(() => import("../../../views/projects/ProjectsEdit.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function normalizeMountPath(pathValue, fallbackPath = "/projects") {
  const normalized = String(pathValue || "").trim();
  const source = normalized || fallbackPath;
  const withLeadingSlash = source.startsWith("/") ? source : `/${source}`;
  const squashed = withLeadingSlash.replace(/\/+/g, "/");
  if (squashed.length > 1 && squashed.endsWith("/")) {
    return squashed.slice(0, -1);
  }

  return squashed || fallbackPath;
}

function createRoutes({ rootRoute, workspaceRoutePrefix, guards, mountPath = "/projects" }) {
  const normalizedMountPath = normalizeMountPath(mountPath, "/projects");
  const listPath = `${workspaceRoutePrefix}${normalizedMountPath}`;
  const addPath = `${listPath}/add`;
  const viewPath = `${listPath}/$projectId`;
  const editPath = `${viewPath}/edit`;

  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: listPath,
      component: ProjectsListView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.read"])
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: addPath,
      component: ProjectsAddView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.write"])
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: editPath,
      component: ProjectsEditView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.write"])
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: viewPath,
      component: ProjectsView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.read"])
    })
  ];
}

export { createRoutes };
