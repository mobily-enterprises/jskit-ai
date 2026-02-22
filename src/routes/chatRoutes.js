import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const ChatView = lazyRouteComponent(() => import("../views/chat/ChatView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function createRoutes({ rootRoute, workspaceRoutePrefix, guards }) {
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/chat`,
      component: ChatView,
      beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["chat.read"])
    })
  ];
}

export { createRoutes };
