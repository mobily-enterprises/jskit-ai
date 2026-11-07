import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory, RouterView } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "@jskit-ai/shell-web/client/error";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "@jskit-ai/shell-web/client/placement";
import AuthProfileWidget from "../../src/client/views/AuthProfileWidget.vue";
import DefaultLoginView from "../../src/client/views/DefaultLoginView.vue";
import DefaultResetPasswordView from "../../src/client/views/DefaultResetPasswordView.vue";
import DefaultSignOutView from "../../src/client/views/DefaultSignOutView.vue";
import { AuthWebClientProvider } from "../../src/client/providers/AuthWebClientProvider.js";
import { useAuthStore } from "../../src/client/stores/useAuthStore.js";

// The shell's two runtimes as doubles; the auth client above them is the real one the provider builds.
window.authFixture = { reports: [], bootstrapRefreshes: [], context: {} };

let context = {
  surfaceConfig: {
    tenancyMode: "none",
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "auth"],
    surfacesById: {
      home: { id: "home", enabled: true, pagesRoot: "home", routeBase: "/home", requiresWorkspace: false },
      auth: { id: "auth", enabled: true, pagesRoot: "auth", routeBase: "/auth", requiresWorkspace: false }
    }
  }
};
const placement = {
  getContext: () => context,
  getPlacements: () => [],
  getRevision: () => 0,
  subscribe: () => () => {},
  setContext(patch) {
    context = { ...context, ...patch };
    window.authFixture.context = patch;
    return context;
  }
};
const errorRuntime = {
  report(event) {
    window.authFixture.reports.push(event);
    return { skipped: false };
  },
  dismiss: () => 0
};
const shell = {
  placement,
  bootstrap: {
    async refresh(reason) {
      window.authFixture.bootstrapRefreshes.push(reason);
    }
  }
};

const HomePage = {
  setup() {
    const auth = useAuthStore();
    return () => h("div", [
      h("p", { "data-testid": "home" }, `Signed in: ${auth.authenticated}`),
      h(AuthProfileWidget)
    ]);
  }
};
// An app's brand in the auth views' brand slot: a pane's wordmark and line on wide windows, a compact row on phones.
function branded(View) {
  return {
    render: () => h(View, null, {
      brand: ({ compact }) => compact
        ? h("div", { class: "text-title-medium", "data-testid": "fixture-brand-row" }, "Racerlog")
        : [
            h("div", { class: "text-title-large", "data-testid": "fixture-brand-pane" }, "Racerlog"),
            h("p", { class: "text-display-medium" }, "Your setup. Every lap.")
          ]
    })
  };
}
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/home", component: HomePage },
    { path: "/auth/login", component: DefaultLoginView },
    { path: "/auth/reset-password", component: DefaultResetPasswordView },
    { path: "/auth/signout", component: DefaultSignOutView },
    { path: "/auth/branded/login", component: branded(DefaultLoginView) },
    { path: "/auth/branded/reset-password", component: branded(DefaultResetPasswordView) },
    { path: "/auth/branded/signout", component: branded(DefaultSignOutView) }
  ]
});
const app = createApp({ render: () => h(components.VApp, null, { default: () => h(components.VMain, null, { default: () => h(RouterView) }) }) });
const pinia = createPinia();
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placement);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
app.use(pinia);
app.use(router);
app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
app.use(createVuetify({ components, directives, ...createMaterialVuetifyOptions() }));
// The kernel hands an absent optional capability to a provider as null.
const outputs = AuthWebClientProvider.setup({
  components: { register() {} },
  mobile: null,
  pinia,
  realtime: null,
  shell,
  vueApp: app
});
await AuthWebClientProvider.boot({}, { outputs });
await router.isReady();
app.mount("#app");
