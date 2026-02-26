import { createRoute, lazyRouteComponent, redirect } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const AssistantView = lazyRouteComponent(() => import("../../../views/assistant/AssistantView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function normalizeMountPath(pathValue, fallbackPath = "/assistant") {
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

function createRoutes({ rootRoute, workspaceRoutePrefix, guards, mountPath = "/assistant", mountAliases = [] }) {
  const normalizedMountPath = normalizeMountPath(mountPath, "/assistant");
  const aliasPaths = normalizeMountAliases(mountAliases, normalizedMountPath);
  const routePath = `${workspaceRoutePrefix}${normalizedMountPath}`;

  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      component: AssistantView,
      beforeLoad: guards.beforeLoadAssistant
    }),
    ...aliasPaths.map((aliasPath) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: `${workspaceRoutePrefix}${aliasPath}`,
        component: AssistantView,
        beforeLoad: async (context) => {
          await guards.beforeLoadAssistant(context);
          throw redirect({
            to: routePath,
            params: {
              workspaceSlug: context?.params?.workspaceSlug
            },
            replace: true
          });
        }
      })
    )
  ];
}

export { createRoutes };
