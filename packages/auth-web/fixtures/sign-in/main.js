import { createApp, h, ref } from "vue";
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
import SecondFactorDialog from "../../src/client/views/SecondFactorDialog.vue";
import SecondFactorSettings from "../../src/client/views/SecondFactorSettings.vue";
import { useSecondFactorStepUp } from "../../src/client/composables/secondFactor/useSecondFactorStepUp.js";
import { authHttpRequest } from "../../src/client/runtime/authHttpClient.js";
import { AuthWebClientProvider } from "../../src/client/providers/AuthWebClientProvider.js";
import { useAuthStore } from "../../src/client/stores/useAuthStore.js";
import PatternLoginPage from "../../patterns/auth-surface/example/src/pages/auth/login.vue";
import PatternResetPasswordPage from "../../patterns/auth-surface/example/src/pages/auth/reset-password.vue";
import PatternSignOutPage from "../../patterns/auth-surface/example/src/pages/auth/signout.vue";

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
// An account settings section with the authenticator, which counts the times the person said they saved new codes.
const SecondFactorPage = {
  setup() {
    const codesSaved = ref(0);
    return () => h("div", [
      h(SecondFactorSettings, { onCodesSaved: () => { codesSaved.value += 1; } }),
      h("p", { "data-testid": "codes-saved" }, `Codes saved: ${codesSaved.value}`)
    ]);
  }
};
// An application's console: its refund route asks for a code proved within five minutes, through the step-up dialog.
const ConsolePage = {
  setup() {
    const { open, run, verified, cancel } = useSecondFactorStepUp();
    const outcome = ref("");
    async function refund() {
      try {
        await run(() => authHttpRequest("/api/console/refund", { method: "POST" }));
        outcome.value = "Refunded";
      } catch (error) {
        outcome.value = `Refund failed: ${error.message}`;
      }
    }
    return () => h("div", [
      h(components.VBtn, { onClick: refund }, () => "Refund"),
      h("p", { "data-testid": "console-outcome" }, outcome.value),
      h(SecondFactorDialog, { open: open.value, onVerified: verified, onCancel: cancel })
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
    { path: "/account/second-factor", component: SecondFactorPage },
    { path: "/console", component: ConsolePage },
    { path: "/auth/login", component: DefaultLoginView },
    { path: "/auth/reset-password", component: DefaultResetPasswordView },
    { path: "/auth/signout", component: DefaultSignOutView },
    { path: "/auth/branded/login", component: branded(DefaultLoginView) },
    { path: "/auth/branded/reset-password", component: branded(DefaultResetPasswordView) },
    { path: "/auth/branded/signout", component: branded(DefaultSignOutView) },
    // The auth-surface pattern's own pages, as an app copies them: its view wrappers show the app's brand.
    { path: "/auth/pattern/login", component: PatternLoginPage },
    { path: "/auth/pattern/reset-password", component: PatternResetPasswordPage },
    { path: "/auth/pattern/signout", component: PatternSignOutPage }
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
