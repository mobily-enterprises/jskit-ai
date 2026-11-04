import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory, RouterView } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
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
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/home", component: HomePage },
    { path: "/auth/login", component: DefaultLoginView },
    { path: "/auth/reset-password", component: DefaultResetPasswordView },
    { path: "/auth/signout", component: DefaultSignOutView }
  ]
});
const app = createApp({ render: () => h(components.VApp, null, { default: () => h(components.VMain, null, { default: () => h(RouterView) }) }) });
const pinia = createPinia();
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placement);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
app.use(pinia);
app.use(router);
app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
app.use(createVuetify({ components, directives, icons: { defaultSet: "mdi", aliases, sets: { mdi } } }));
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
