import { createApp, h } from "vue";
import { createRouter, createWebHistory, RouterView } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import WorkspaceMembersClientElement from "../../src/client/components/WorkspaceMembersClientElement.vue";

const context = {
  permissions: ["*"],
  surfaceConfig: {
    tenancyMode: "workspaces",
    defaultSurfaceId: "admin",
    enabledSurfaceIds: ["admin"],
    surfacesById: {
      admin: { id: "admin", enabled: true, pagesRoot: "w/[workspaceSlug]/admin", routeBase: "/w/:workspaceSlug/admin", requiresWorkspace: true }
    }
  }
};
const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/w/:workspaceSlug/admin/members", component: WorkspaceMembersClientElement }]
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
