import { createApp, h, ref } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory, RouterView } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "@jskit-ai/shell-web/client/error";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "@jskit-ai/shell-web/client/placement";
import { useSecondFactorStepUp } from "@jskit-ai/auth-web/client/composables/useSecondFactorStepUp";
import { authHttpRequest } from "@jskit-ai/auth-web/client/runtime/authHttpClient";
import { AuthWebClientProvider } from "../../src/client/providers/AuthWebClientProvider.js";
import LoginPage from "../../patterns/auth-surface/example/src/pages/auth/login.vue";
import ConfirmItsYouDialog from "../../patterns/own-design-sign-in/example/src/components/ConfirmItsYouDialog.vue";
import "../../patterns/own-design-sign-in/example/src/theme/tokens.css";

// An application with its own design system and no Vuetify: no Vuetify plugin, no Material styles. Its sign-in page is
// auth-surface's own page, which renders the app's view (the own-design-sign-in pattern's LoginView.vue), and its
// console asks for the second factor through the pattern's own prompt. The shell's two runtimes are doubles; the auth
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

// The app's console: its refund route asks for a code proved within five minutes, through the app's own prompt.
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
    return () => h("main", { class: "console" }, [
      h("h1", "Console"),
      h("button", { type: "button", onClick: refund }, "Refund"),
      h("p", { "data-testid": "console-outcome" }, outcome.value),
      h(ConfirmItsYouDialog, { open: open.value, onVerified: verified, onCancel: cancel })
    ]);
  }
};

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/console" },
    { path: "/console", component: ConsolePage },
    { path: "/auth/login", component: LoginPage }
  ]
});
const app = createApp({ render: () => h(RouterView) });
const pinia = createPinia();
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placement);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
app.use(pinia);
app.use(router);
app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
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
