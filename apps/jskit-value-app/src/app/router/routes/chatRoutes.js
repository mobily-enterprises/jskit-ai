import { createRoute, lazyRouteComponent, redirect } from "@tanstack/vue-router";
import { createSurfacePaths } from "../../../../shared/surfacePaths.js";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const ChatView = lazyRouteComponent(() => import("../../../views/chat/ChatView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function normalizeSurfaceId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeMountPath(pathValue, fallbackPath = "/chat") {
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

function createRoutes({ rootRoute, workspaceRoutePrefix, guards, surface, mountPath = "/chat", mountAliases = [] }) {
  const normalizedSurface = normalizeSurfaceId(surface);
  const adminPaths = createSurfacePaths("admin");
  const normalizedMountPath = normalizeMountPath(mountPath, "/chat");
  const aliasPaths = normalizeMountAliases(mountAliases, normalizedMountPath);
  const routePath = `${workspaceRoutePrefix}${normalizedMountPath}`;
  const adminWorkspaceChatRoutePath = `${adminPaths.prefix}/w/$workspaceSlug${normalizedMountPath}`;

  const chatRouteBeforeLoad = async (context) => {
    await guards.beforeLoadWorkspacePermissionsRequired(context, ["chat.read"]);

    if (normalizedSurface !== "admin") {
      throw redirect({
        to: adminWorkspaceChatRoutePath,
        params: {
          workspaceSlug: context?.params?.workspaceSlug
        },
        replace: true
      });
    }
  };

  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      component: ChatView,
      beforeLoad: chatRouteBeforeLoad
    }),
    ...aliasPaths.map((aliasPath) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: `${workspaceRoutePrefix}${aliasPath}`,
        component: ChatView,
        beforeLoad: async (context) => {
          await guards.beforeLoadWorkspacePermissionsRequired(context, ["chat.read"]);
          throw redirect({
            to: normalizedSurface === "admin" ? routePath : adminWorkspaceChatRoutePath,
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
