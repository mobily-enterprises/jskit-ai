import { createApp, h, reactive, ref, shallowReactive } from "vue";
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
import AccountSettingsClientElement from "../../src/client/components/AccountSettingsClientElement.vue";
import ProfileClientElement from "../../src/client/components/ProfileClientElement.vue";
import { useAccountLocale } from "../../src/client/lib/accountLocale.js";
import NotificationsSection from "../../patterns/account-settings/example/src/components/account/settings/AccountSettingsNotificationsSection.vue";
import PreferencesSection from "../../patterns/account-settings/example/src/components/account/settings/AccountSettingsPreferencesSection.vue";
import ProfileSection from "../../patterns/account-settings/example/src/components/account/settings/AccountSettingsProfileSection.vue";
import SignInMethodsSection from "../../patterns/account-settings/example/src/components/account/settings/AccountSettingsSignInMethodsSection.vue";

function section(value, title, component, order) {
  return { order, component, props: { value, title, usesSharedRuntime: true } };
}

// The shell's two runtimes as doubles; everything below them is the real account settings code.
const context = {
  surfaceConfig: {
    tenancyMode: "none",
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "account"],
    surfacesById: {
      home: { id: "home", enabled: true, pagesRoot: "home", routeBase: "/home", requiresWorkspace: false },
      account: { id: "account", enabled: true, pagesRoot: "account", routeBase: "/account", requiresWorkspace: false }
    }
  }
};
const listeners = new Set();
let revision = 1;
let placements = new URLSearchParams(window.location.search).has("empty")
  ? []
  : [
      section("profile", "Profile", ProfileSection, 100),
      section("preferences", "Preferences", PreferencesSection, 200),
      section("notifications", "Notifications", NotificationsSection, 300),
      section("sign-in-methods", "Sign-in methods", SignInMethodsSection, 400)
    ];
const placement = {
  getContext: () => context,
  setContext: () => context,
  getPlacements: () => placements,
  getRevision: () => revision,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};
const errorRuntime = {
  report(event) {
    window.accountFixture.reports.push(event);
    return { skipped: false };
  },
  dismiss: () => 0
};

// What a host passes ProfileClientElement: forms and pending flags, with actions the test can make fail.
const profileProps = reactive({ copy: {}, variant: {}, features: {}, ui: {} });
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
const actions = {
  async submitProfile() {},
  async openAvatarEditor() {
    profileState.selectedAvatarFileName = "ada.png";
  },
  async submitAvatarDelete() {
    throw new Error("Avatar service down.");
  }
};
function record(name) {
  return (payload) => window.accountFixture.events.push({ name, payload });
}

window.accountFixture = {
  reports: [],
  events: [],
  profileProps,
  profileState,
  placeSection() {
    placements = [...placements, section("extra", "Extra", { render: () => h("p", "Extra section") }, 150)];
    revision += 1;
    listeners.forEach((listener) => listener({ revision }));
  }
};

const AccountPage = {
  setup() {
    const accountLocale = useAccountLocale();
    return () => h("div", [
      h("p", { "data-testid": "account-locale" }, accountLocale.value),
      h(AccountSettingsClientElement)
    ]);
  }
};
const ProfileElementPage = {
  render: () => h(ProfileClientElement, {
    state: profileState,
    actions,
    ...profileProps,
    "onProfile:submit": record("profile:submit"),
    "onAvatar:replace": record("avatar:replace"),
    "onAvatar:remove": record("avatar:remove"),
    onInteraction: record("interaction"),
    "onAction:started": record("action:started"),
    "onAction:succeeded": record("action:succeeded"),
    "onAction:failed": record("action:failed")
  }, {
    "form-after": ({ state }) => h("p", { "data-testid": "form-after" }, state.profileForm.email)
  })
};
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/home", component: { render: () => h("p", { "data-testid": "home" }, "Home") } },
    { path: "/account", component: AccountPage },
    { path: "/profile-element", component: ProfileElementPage }
  ]
});
const app = createApp({ render: () => h(components.VApp, null, { default: () => h(components.VMain, null, { default: () => h(RouterView) }) }) });
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placement);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
app.use(router);
app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
app.use(createVuetify({ components, directives, ...createMaterialVuetifyOptions() }));
await router.isReady();
app.mount("#app");
