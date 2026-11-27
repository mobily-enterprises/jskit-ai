import { createApp, defineAsyncComponent, h, ref } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory, RouterView, useRoute } from "vue-router";
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
import { useSecondFactorStepUp } from "../../src/client/composables/useSecondFactorStepUp.js";
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
  isContextPending: () => false,
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
// An application's console, in the shell's layout as an app's screens are: its refund route asks for a code proved
// within five minutes, through the step-up dialog, over the page the shell makes inert while the dialog is open.
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
    // The app's home, where a pass sign-in goes.
    { path: "/", redirect: "/home" },
    { path: "/home", component: HomePage },
    { path: "/account/second-factor", component: SecondFactorPage },
    { path: "/console", component: ConsolePage, meta: { shell: true } },
    { path: "/auth/login", component: DefaultLoginView },
    { path: "/auth/reset-password", component: DefaultResetPasswordView },
    { path: "/auth/signout", component: DefaultSignOutView },
    // An app whose "/" is not its app names where a sign-in lands.
    { path: "/auth/landing/login", component: { render: () => h(DefaultLoginView, { fallbackReturnTo: "/home?landed=app" }) } },
    { path: "/auth/branded/login", component: branded(DefaultLoginView) },
    { path: "/auth/branded/reset-password", component: branded(DefaultResetPasswordView) },
    { path: "/auth/branded/signout", component: branded(DefaultSignOutView) },
    // The auth-surface pattern's own pages, as an app copies them: its view wrappers show the app's brand.
    { path: "/auth/pattern/login", component: PatternLoginPage },
    { path: "/auth/pattern/reset-password", component: PatternResetPasswordPage },
    { path: "/auth/pattern/signout", component: PatternSignOutPage }
  ]
});
// A page in the shell's layout (`meta.shell`) has the layout's main; the others have a plain one. Only the console
// page is in the layout, so only it loads the layout: the sign-in pages load what they did before.
const ShellLayout = defineAsyncComponent(() => import("@jskit-ai/shell-web/client/components/ShellLayout"));
const app = createApp({
  setup() {
    const route = useRoute();
    return () => h(components.VApp, null, {
      default: () => route.meta.shell
        ? h(ShellLayout, { title: "Console" }, { default: () => h(RouterView) })
        : h(components.VMain, null, { default: () => h(RouterView) })
    });
  }
});
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
