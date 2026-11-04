import { createApp, h, reactive } from "vue";
import { createRouter, createWebHistory, RouterView, useRoute } from "vue-router";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import AccountSettingsInvitesSection from "../../src/client/components/AccountSettingsInvitesSection.vue";
import WorkspaceSelector from "../../src/client/components/WorkspaceSelector.vue";

// What the shell's placement context holds for a signed-in person once workspaces-web's bootstrap has run on /w/acme.
const context = {
  auth: { authenticated: true },
  workspace: { id: "2", slug: "acme", name: "Acme", roleSid: "member" },
  workspaces: [
    { id: "1", slug: "home", name: "Home", roleSid: "owner" },
    { id: "2", slug: "acme", name: "Acme", roleSid: "member" },
    { id: "3", slug: "zen", name: "Zen Garden", roleSid: "member" }
  ],
  surfaceConfig: {
    tenancyMode: "workspaces",
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "account", "app", "admin"],
    surfacesById: {
      home: { id: "home", enabled: true, pagesRoot: "home", routeBase: "/home", requiresWorkspace: false },
      account: { id: "account", enabled: true, pagesRoot: "account", routeBase: "/account", requiresWorkspace: false },
      app: { id: "app", enabled: true, pagesRoot: "w/[workspaceSlug]", routeBase: "/w/:workspaceSlug", requiresWorkspace: true },
      admin: { id: "admin", enabled: true, pagesRoot: "w/[workspaceSlug]/admin", routeBase: "/w/:workspaceSlug/admin", requiresWorkspace: true }
    }
  }
};

// The shell shows what its error runtime is given; the fixture lists it.
const feedback = reactive([]);
const errorRuntime = {
  report(event) {
    feedback.push(`${event.severity}: ${event.message}`);
    return { skipped: false };
  },
  dismiss() {
    return 0;
  }
};

function pageFor(label) {
  return {
    setup() {
      const route = useRoute();
      return () => h("p", { class: "fixture-page" }, route.params.workspaceSlug ? `${label} ${route.params.workspaceSlug}` : label);
    }
  };
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/home", component: pageFor("Home page") },
    { path: "/account", component: { render: () => h(components.VContainer, null, { default: () => h(AccountSettingsInvitesSection) }) } },
    { path: "/w/:workspaceSlug", component: pageFor("Opened") },
    { path: "/w/:workspaceSlug/admin", component: pageFor("Admin of") }
  ]
});

// The selector sits in the shell's identity slot on every surface, as its placement puts it.
const app = createApp({
  render: () => h(components.VApp, null, {
    default: () => [
      h(components.VAppBar, { flat: true }, { default: () => h(WorkspaceSelector) }),
      h(components.VMain, null, {
        default: () => [
          h(RouterView),
          h("ul", { class: "fixture-feedback" }, feedback.map((entry) => h("li", entry)))
        ]
      })
    ]
  })
});
app.provide("jskit.shell-web.runtime.web-placement.client", {
  getContext: () => context,
  getPlacements: () => [],
  subscribe: () => () => {},
  setContext: () => context
});
app.provide("jskit.shell-web.runtime.web-error.client", errorRuntime);
app.use(router);
app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
app.use(createVuetify({ components, directives, icons: { defaultSet: "mdi", aliases, sets: { mdi } } }));
await router.isReady();
app.mount("#app");
