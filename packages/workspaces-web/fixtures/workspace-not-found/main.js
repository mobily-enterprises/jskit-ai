import { createApp, h, onMounted } from "vue";
import { createRouter, createWebHistory, RouterLink, RouterView, useRoute } from "vue-router";
import { createShellRouter } from "@jskit-ai/kernel/client";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";
import { createBootstrapPayloadHandlerRegistry } from "../../../shell-web/src/client/bootstrap/bootstrapPayloadHandlerRegistry.js";
import { createWebPlacementRuntime } from "../../../shell-web/src/client/placement/runtime.js";
import { createShellBootstrapRuntime } from "../../../shell-web/src/client/runtime/bootstrapRuntime.js";
import { createBootstrapPlacementRuntime } from "../../src/client/runtime/bootstrapPlacementRuntime.js";

// An application with workspaces as the shell starts it: its router from createShellRouter (the shell guard and the
// Not found page), the shell's bootstrap and workspaces-web's runtime, booted in the client modules' order.
const surfaces = {
  home: { pagesRoot: "home" },
  app: { pagesRoot: "w/[workspaceSlug]", requiresAuth: true, requiresWorkspace: true }
};
const placementRuntime = createWebPlacementRuntime({ components: new Map(), logger: silentLogger });
// The person is signed in, as auth-web's runtime writes it.
placementRuntime.setContext({
  auth: { authenticated: true },
  surfaceConfig: {
    tenancyMode: "workspaces",
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "app"],
    surfacesById: {
      home: { id: "home", enabled: true, routeBase: "/home", requiresWorkspace: false, ...surfaces.home },
      app: { id: "app", enabled: true, routeBase: "/w/:workspaceSlug", ...surfaces.app }
    }
  }
});

// Each workspace screen asks for its data when it opens, as an application's does, so the test sees which ran.
function workspaceScreen(name) {
  return {
    setup() {
      const route = useRoute();
      onMounted(() => {
        void fetch(`/api/w/${route.params.workspaceSlug}/${name}`);
      });
      return () => h("h1", `${route.params.workspaceSlug} ${name}`);
    }
  };
}
const WorkspaceLayout = {
  setup() {
    const route = useRoute();
    return () =>
      h("div", [
        h("nav", { "aria-label": "Workspace" }, [
          h(RouterLink, { to: `/w/${route.params.workspaceSlug}/projects` }, () => "Projects"),
          h(RouterLink, { to: "/w/nope" }, () => "A stale link")
        ]),
        h(RouterView)
      ]);
  }
};
const Home = { render: () => h("main", [h("h1", "Home"), h(RouterLink, { to: "/w/acme" }, () => "Acme")]) };
const NotFound = { render: () => h("main", [h("h1", "Page not found"), h(RouterLink, { to: "/home" }, () => "Go home")]) };

const { router } = createShellRouter({
  createRouter,
  history: createWebHistory(),
  routes: [
    { path: "/home", component: Home },
    {
      path: "/w/:workspaceSlug",
      component: WorkspaceLayout,
      children: [
        { path: "", component: workspaceScreen("home") },
        { path: "projects", component: workspaceScreen("projects") }
      ]
    }
  ],
  surfaceRuntime: createSurfaceRuntime({ defaultSurfaceId: "home", surfaces }),
  surfaceMode: "all",
  notFoundComponent: NotFound,
  guard: {}
});
const app = createApp({ render: () => h(RouterView) });

const handlers = createBootstrapPayloadHandlerRegistry();
const bootstrap = createShellBootstrapRuntime({
  handlers,
  placementRuntime,
  requestRecoveryRuntime: { report() {} },
  router,
  logger: silentLogger
});
const workspaces = createBootstrapPlacementRuntime({
  bootstrapRuntime: bootstrap,
  placementRuntime,
  realtime: null,
  router,
  vueApp: app,
  logger: silentLogger
});
handlers.register({
  handlerId: "workspaces.web.bootstrap",
  order: 100,
  resolveBootstrapRequest: workspaces.resolveBootstrapRequest,
  applyBootstrapPayload: workspaces.applyBootstrapPayload,
  handleBootstrapError: workspaces.handleBootstrapError
});
await bootstrap.initialize();
await workspaces.initialize();
app.use(router);
await router.isReady();
app.mount("#app");
