import { createApp, h } from "vue";
import { createRouter, createWebHistory, RouterView, useRoute } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import WorkspacesClientElement from "../../src/client/components/WorkspacesClientElement.vue";

const context = {
  surfaceConfig: {
    tenancyMode: "workspaces",
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "app"],
    surfacesById: {
      home: { id: "home", enabled: true, pagesRoot: "home", routeBase: "/home", requiresWorkspace: false },
      app: { id: "app", enabled: true, pagesRoot: "w/[workspaceSlug]", routeBase: "/w/:workspaceSlug", requiresWorkspace: true }
    }
  }
};
const OpenedWorkspace = {
  setup() {
    const route = useRoute();
    return () => h("p", `Opened ${route.params.workspaceSlug}`);
  }
};
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/home/workspaces", component: WorkspacesClientElement },
    { path: "/w/:workspaceSlug", component: OpenedWorkspace }
  ]
});
const app = createApp({ render: () => h(components.VApp, null, { default: () => h(components.VMain, null, { default: () => h(RouterView) }) }) });
app.provide("jskit.shell-web.runtime.web-placement.client", {
  getContext: () => context,
  getPlacements: () => [],
  subscribe: () => () => {},
  setContext: () => context
});
app.use(router);
app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
app.use(createVuetify({ components, directives, icons: { defaultSet: "mdi", aliases, sets: { mdi } } }));
await router.isReady();
app.mount("#app");
