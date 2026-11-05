import { createApp, h, inject, onMounted, reactive, ref, shallowReactive } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory, RouterView } from "vue-router";
import { QueryClient, VueQueryPlugin, useQuery } from "@tanstack/vue-query";
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import { registerJskitMessages, setJskitI18n } from "@jskit-ai/kernel/client/i18n";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { ShellErrorHost, ShellWebClientProvider, useShellErrorPresentationStore } from "@jskit-ai/shell-web/client";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "@jskit-ai/shell-web/client/error";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "@jskit-ai/shell-web/client/placement";
import { SHELL_REQUEST_RECOVERY_RUNTIME_KEY } from "@jskit-ai/shell-web/client/requestRecovery";
import {
  AuthProfileMenuLinkItem,
  AuthProfileWidget,
  AuthWebClientProvider,
  DefaultLoginView,
  DefaultResetPasswordView,
  DefaultSignOutView
} from "@jskit-ai/auth-web/client";
import AccountSettingsClientElement from "../../src/client/components/AccountSettingsClientElement.vue";
import ProfileClientElement from "../../src/client/components/ProfileClientElement.vue";
import appMessages from "./appMessages.json" with { type: "json" };
import PreferencesSection from "./PreferencesSection.vue";

// An app translated into the locale the test exported with `jskit i18n export`
// and handed to the page. Every JSKIT package's English is registered, as the
// JSKIT Vite plugin registers each installed package's catalog.
const translation = window.translatedFixture;
const catalogs = import.meta.glob("../../../*/locales/en.json", { eager: true, import: "default" });
Object.values(catalogs).forEach(registerJskitMessages);
const i18n = createI18n({
  legacy: false,
  locale: translation.locale,
  fallbackLocale: "en",
  messages: { en: appMessages, [translation.locale]: translation.messages },
  missingWarn: false,
  fallbackWarn: false,
  warnHtmlMessage: false
});
setJskitI18n(i18n);

const registered = new Map();
const componentRegistry = {
  register(id, component) {
    registered.set(id, component);
    return componentRegistry;
  },
  has: (id) => registered.has(id),
  get: (id) => registered.get(id)
};

// The shell's placements as a double; the error runtime, its host and request
// recovery are the real ones ShellWebClientProvider builds.
let context = {
  surfaceConfig: {
    tenancyMode: "none",
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "auth", "account"],
    surfacesById: {
      home: { id: "home", enabled: true, pagesRoot: "home", routeBase: "/home", requiresWorkspace: false },
      auth: { id: "auth", enabled: true, pagesRoot: "auth", routeBase: "/auth", requiresWorkspace: false },
      account: { id: "account", enabled: true, pagesRoot: "account", routeBase: "/account", requiresWorkspace: false }
    }
  }
};

// What a host passes ProfileClientElement.
const profileState = shallowReactive({
  profileForm: reactive({ displayName: "Ada", email: "ada@example.com" }),
  preferencesForm: reactive({ avatarSize: 64 }),
  profileAvatar: reactive({ effectiveUrl: "", hasUploadedAvatar: true }),
  profileInitials: "AD",
  selectedAvatarFileName: "",
  profileFieldErrors: reactive({}),
  profileMutation: { isPending: ref(false) },
  avatarDeleteMutation: { isPending: ref(false) }
});
const profileActions = {
  async submitProfile() {},
  async openAvatarEditor() {},
  async submitAvatarDelete() {}
};
const ProfileSection = { render: () => h(ProfileClientElement, { state: profileState, actions: profileActions }) };

function section(value, title, component, order) {
  return { order, component, props: { value, title, usesSharedRuntime: true } };
}
const placementsByTarget = {
  "account-settings:sections": [
    section("profile", "jskit.users.accountSettings.profile.title", ProfileSection, 100),
    section("preferences", "app.settings.preferences", PreferencesSection, 200)
  ],
  "auth-profile-menu:primary-menu": [
    { id: "app.menu.settings", component: AuthProfileMenuLinkItem, props: { label: "app.menu.settings", to: "/account" } },
    { id: "app.menu.sign-out", component: AuthProfileMenuLinkItem, props: { label: "app.menu.signOut", to: "/auth/signout" } }
  ]
};
const placement = {
  getContext: () => context,
  getPlacements: ({ target } = {}) => placementsByTarget[target] || [],
  getRevision: () => 0,
  subscribe: () => () => {},
  setContext(patch) {
    context = { ...context, ...patch };
    return context;
  }
};

const fixtureHttp = createHttpClient({ credentials: "include" });
// A page whose requests fail: a query the shell's request recovery reports as
// a banner, and a request the page reports itself as a snackbar (the shell
// shows one banner at a time).
const ErrorsPage = {
  setup() {
    const errorRuntime = inject(SHELL_WEB_ERROR_RUNTIME_KEY);
    useQuery({
      queryKey: ["fixture", "offline"],
      queryFn: () => fixtureHttp.request("/api/offline"),
      meta: { jskit: { requestRecoveryMethod: "GET" } }
    });
    onMounted(async () => {
      try {
        await fixtureHttp.request("/api/broken");
      } catch (error) {
        errorRuntime.report({ source: "fixture.errors", message: error.message, cause: error, severity: "error", channel: "snackbar" });
      }
    });
    return () => h("div", { "data-testid": "errors-page" });
  }
};
const HomePage = { render: () => h("div", { "data-testid": "home" }, [h(AuthProfileWidget)]) };

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/home", component: HomePage },
    { path: "/errors", component: ErrorsPage },
    { path: "/account", component: AccountSettingsClientElement },
    { path: "/auth/login", component: DefaultLoginView },
    { path: "/auth/reset-password", component: DefaultResetPasswordView },
    { path: "/auth/signout", component: DefaultSignOutView }
  ]
});
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const pinia = createPinia();
const app = createApp({
  render: () => h(components.VApp, null, {
    default: () => [h(components.VMain, null, { default: () => h(RouterView) }), h(ShellErrorHost)]
  })
});
app.use(i18n);
app.use(pinia);
app.use(router);
app.use(VueQueryPlugin, { queryClient });
app.use(createVuetify({ components, directives, icons: { defaultSet: "mdi", aliases, sets: { mdi } } }));

const { shell } = ShellWebClientProvider.setup({ components: componentRegistry, logger: silentLogger, queryClient, router });
shell.error.configure({});
useShellErrorPresentationStore(pinia).attachRuntimeStore(shell.errorPresentationStore);
shell.requestRecovery.install();
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placement);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, shell.error);
app.provide(SHELL_REQUEST_RECOVERY_RUNTIME_KEY, shell.requestRecovery);

const outputs = AuthWebClientProvider.setup({
  components: componentRegistry,
  mobile: null,
  pinia,
  realtime: null,
  shell: { placement, bootstrap: { async refresh() {} } },
  vueApp: app
});
await AuthWebClientProvider.boot({}, { outputs });
await router.isReady();
app.mount("#app");
