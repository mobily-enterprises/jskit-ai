import { createRoute, lazyRouteComponent, redirect } from "@tanstack/vue-router";
import { createSurfacePaths } from "../../shared/routing/surfacePaths.js";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const ChatView = lazyRouteComponent(() => import("../views/chat/ChatView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function normalizeSurfaceId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function createRoutes({ rootRoute, workspaceRoutePrefix, guards, surface }) {
  const normalizedSurface = normalizeSurfaceId(surface);
  const adminPaths = createSurfacePaths("admin");
  const adminWorkspaceChatRoutePath = `${adminPaths.prefix}/w/$workspaceSlug/chat`;

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
      path: `${workspaceRoutePrefix}/chat`,
      component: ChatView,
      beforeLoad: chatRouteBeforeLoad
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/workspace-chat`,
      component: ChatView,
      beforeLoad: async (context) => {
        await guards.beforeLoadWorkspacePermissionsRequired(context, ["chat.read"]);
        throw redirect({
          to: normalizedSurface === "admin" ? `${workspaceRoutePrefix}/chat` : adminWorkspaceChatRoutePath,
          params: {
            workspaceSlug: context?.params?.workspaceSlug
          },
          replace: true
        });
      }
    })
  ];
}

export { createRoutes };
