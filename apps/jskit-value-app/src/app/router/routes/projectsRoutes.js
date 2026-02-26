import { createRoute, lazyRouteComponent, redirect } from "@tanstack/vue-router";

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

function normalizeMountAliases(mountAliases, mountPath) {
  const aliases = [];
  const seen = new Set();
  for (const aliasValue of Array.isArray(mountAliases) ? mountAliases : []) {
    const aliasPath = normalizeMountPath(aliasValue, mountPath);
    if (aliasPath === mountPath || seen.has(aliasPath)) {
      continue;
    }
    seen.add(aliasPath);
    aliases.push(aliasPath);
  }

  return aliases;
}

function createRoutes({ rootRoute, workspaceRoutePrefix, guards, mountPath = "/projects", mountAliases = [] }) {
  const normalizedMountPath = normalizeMountPath(mountPath, "/projects");
  const aliasPaths = normalizeMountAliases(mountAliases, normalizedMountPath);
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
    }),
    ...aliasPaths.map((aliasPath) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: `${workspaceRoutePrefix}${aliasPath}`,
        component: ProjectsListView,
        beforeLoad: async (context) => {
          await guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.read"]);
          throw redirect({
            to: listPath,
            params: {
              workspaceSlug: context?.params?.workspaceSlug
            },
            replace: true
          });
        }
      })
    ),
    ...aliasPaths.map((aliasPath) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: `${workspaceRoutePrefix}${aliasPath}/add`,
        component: ProjectsAddView,
        beforeLoad: async (context) => {
          await guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.write"]);
          throw redirect({
            to: addPath,
            params: {
              workspaceSlug: context?.params?.workspaceSlug
            },
            replace: true
          });
        }
      })
    ),
    ...aliasPaths.map((aliasPath) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: `${workspaceRoutePrefix}${aliasPath}/$projectId/edit`,
        component: ProjectsEditView,
        beforeLoad: async (context) => {
          await guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.write"]);
          throw redirect({
            to: editPath,
            params: {
              workspaceSlug: context?.params?.workspaceSlug,
              projectId: context?.params?.projectId
            },
            replace: true
          });
        }
      })
    ),
    ...aliasPaths.map((aliasPath) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: `${workspaceRoutePrefix}${aliasPath}/$projectId`,
        component: ProjectsView,
        beforeLoad: async (context) => {
          await guards.beforeLoadWorkspacePermissionsRequired(context, ["projects.read"]);
          throw redirect({
            to: viewPath,
            params: {
              workspaceSlug: context?.params?.workspaceSlug,
              projectId: context?.params?.projectId
            },
            replace: true
          });
        }
      })
    )
  ];
}

export { createRoutes };
