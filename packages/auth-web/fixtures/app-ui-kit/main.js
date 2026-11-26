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
import { provideShellUi } from "@jskit-ai/shell-web/client/ui";
import DefaultEmailChangeView from "@jskit-ai/auth-web/client/views/DefaultEmailChangeView";
import DefaultLoginView from "@jskit-ai/auth-web/client/views/DefaultLoginView";
import DefaultResetPasswordView from "@jskit-ai/auth-web/client/views/DefaultResetPasswordView";
import DefaultSignOutView from "@jskit-ai/auth-web/client/views/DefaultSignOutView";
import SecondFactorDialog from "@jskit-ai/auth-web/client/views/SecondFactorDialog";
import SecondFactorSettings from "@jskit-ai/auth-web/client/views/SecondFactorSettings";
import { useSecondFactorStepUp } from "@jskit-ai/auth-web/client/composables/useSecondFactorStepUp";
import { authHttpRequest } from "@jskit-ai/auth-web/client/runtime/authHttpClient";
import { AuthWebClientProvider } from "../../src/client/providers/AuthWebClientProvider.js";
import KitButton from "./KitButton.vue";
import KitDialog from "./KitDialog.vue";

// An application on Vuetify with a design system of its own: it keeps JSKIT's auth views and gives them its own
// button, dialog frame and type classes through shell-web's UI kit. The shell's two runtimes are doubles; the auth
// client under them is the real one the provider builds.
window.authFixture = { reports: [] };

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
const shell = { placement, bootstrap: { async refresh() {} } };

const HomePage = { render: () => h("p", { "data-testid": "home" }, "Home") };
// The app's console: its refund route asks for a code proved within five minutes, through JSKIT's step-up dialog,
// which the kit draws in the app's own frame.
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
    return () => h("main", [
      h("button", { type: "button", onClick: refund }, "Refund"),
      h("p", { "data-testid": "console-outcome" }, outcome.value),
      h(SecondFactorDialog, { open: open.value, onVerified: verified, onCancel: cancel })
    ]);
  }
};
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/home" },
    { path: "/home", component: HomePage },
    { path: "/console", component: ConsolePage },
    { path: "/account/second-factor", component: SecondFactorSettings },
    { path: "/auth/login", component: DefaultLoginView },
    { path: "/auth/reset-password", component: DefaultResetPasswordView },
    { path: "/auth/email-change", component: DefaultEmailChangeView },
    { path: "/auth/signout", component: DefaultSignOutView }
  ]
});
const app = createApp({ render: () => h(components.VApp, null, { default: () => h(components.VMain, null, { default: () => h(RouterView) }) }) });
const pinia = createPinia();
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placement);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
provideShellUi(app, {
  Button: KitButton,
  Dialog: KitDialog,
  text: {
    title: "kit-title",
    heading: "kit-heading",
    subheading: "kit-subheading",
    strong: "kit-strong",
    lead: "kit-lead",
    body: "kit-body",
    caption: "kit-caption"
  }
});
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
