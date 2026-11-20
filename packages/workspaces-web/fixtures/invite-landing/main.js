import { createApp, h } from "vue";
import { createRouter, createWebHistory, RouterView, useRoute } from "vue-router";
import { createPinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { useAuthStore } from "@jskit-ai/auth-web/client";
import WorkspaceInviteLanding from "../../src/client/components/WorkspaceInviteLanding.vue";

// The invitation page as an application routes it, signed in as the test says before the page loads
// (window.inviteLandingAuth), through auth-web's store as its runtime fills it.
const auth = window.inviteLandingAuth || { authenticated: false };
const authRuntime = {
  getState: () => auth,
  subscribe: () => () => {},
  initialize: async () => auth,
  refresh: async () => auth
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
    { path: "/invite/:token", component: WorkspaceInviteLanding },
    { path: "/w/:workspaceSlug", component: OpenedWorkspace }
  ]
});
const pinia = createPinia();
const app = createApp({ render: () => h(components.VApp, null, { default: () => h(RouterView) }) });
app.use(pinia);
useAuthStore(pinia).attachRuntime(authRuntime);
app.use(router);
app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
app.use(createVuetify({ components, directives, ...createMaterialVuetifyOptions() }));
await router.isReady();
app.mount("#app");
