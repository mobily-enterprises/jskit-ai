import { createApp, h, reactive, ref, shallowReactive } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory, RouterView } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "@jskit-ai/shell-web/client/error";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "@jskit-ai/shell-web/client/placement";
import { createWebPlacementRuntime } from "../../../shell-web/src/client/placement/runtime.js";
import {
  SHELL_NAVIGATION_RUNTIME_KEY,
  createShellNavigationRuntime
} from "../../../shell-web/src/client/navigation/shellNavigationRuntime.js";
import AccountSettingsClientElement from "../../src/client/components/AccountSettingsClientElement.vue";
import ProfileClientElement from "../../src/client/components/ProfileClientElement.vue";
import { useAccountLocale } from "../../src/client/lib/accountLocale.js";
import NotificationsSection from "../../patterns/account-settings/example/src/components/account/settings/AccountSettingsNotificationsSection.vue";
import PreferencesSection from "../../patterns/account-settings/example/src/components/account/settings/AccountSettingsPreferencesSection.vue";
import ProfileSection from "../../patterns/account-settings/example/src/components/account/settings/AccountSettingsProfileSection.vue";
import SignInMethodsSection from "../../patterns/account-settings/example/src/components/account/settings/AccountSettingsSignInMethodsSection.vue";

// The real shell (its layout, placements and navigation) around the real account settings code; the error runtime is
// a double that records reports. The account surface is laid out as the account-settings pattern lays it out: /account
// lists the sections and /account/<section> opens one, whose parent is the list.
const sectionComponents = new Map();
function section(value, title, component, order) {
  sectionComponents.set(`fixture.section.${value}`, component);
  return {
    id: `fixture.section.${value}`,
    // The section outlet itself, as the app's topology resolves users-web's sections to it.
    target: "account-settings:sections",
    internal: true,
    kind: "component",
    surfaces: ["account"],
    order,
    componentToken: `fixture.section.${value}`,
    props: { value, title, usesSharedRuntime: true }
  };
}

const placement = createWebPlacementRuntime({ components: sectionComponents, logger: silentLogger });
placement.setContext({
  surfaceConfig: {
    tenancyMode: "none",
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "account"],
    surfacesById: {
      home: { id: "home", enabled: true, pagesRoot: "home", routeBase: "/home", requiresWorkspace: false },
      account: { id: "account", enabled: true, pagesRoot: "account", routeBase: "/account", requiresWorkspace: false }
    }
  }
});
let placements = new URLSearchParams(window.location.search).has("empty")
  ? []
  : [
      section("profile", "Profile", ProfileSection, 100),
      section("preferences", "Preferences", PreferencesSection, 200),
      section("notifications", "Notifications", NotificationsSection, 300),
      section("sign-in-methods", "Sign-in methods", SignInMethodsSection, 400)
    ];
placement.replacePlacements(placements);
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
    placement.replacePlacements(placements);
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
    { path: "/home", component: { render: () => h("p", { "data-testid": "home" }, "Home") }, meta: { jskit: { surface: "home" } } },
    {
      path: "/account",
      component: RouterView,
      meta: { jskit: { surface: "account" } },
      children: [
        // src/pages/account/index.vue: the section list, an inner page of home.
        { path: "", component: AccountPage, meta: { jskit: { parent: { surface: "home", path: "/" } } } },
        // src/pages/account/[section].vue: one section, whose parent is the list.
        { path: ":section", component: AccountPage, meta: { jskit: { parent: "/" } } }
      ]
    },
    { path: "/profile-element", component: ProfileElementPage }
  ]
});
const navigation = createShellNavigationRuntime({ router });
navigation.install();
const app = createApp({
  render: () => h(components.VApp, null, {
    default: () => h(ShellLayout, { surfaceLabel: "Fixture" }, { default: () => h(RouterView) })
  })
});
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placement);
app.provide(SHELL_NAVIGATION_RUNTIME_KEY, navigation);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
app.use(createPinia());
app.use(router);
app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
app.use(createVuetify({ components, directives, ...createMaterialVuetifyOptions() }));
await router.isReady();
app.mount("#app");
