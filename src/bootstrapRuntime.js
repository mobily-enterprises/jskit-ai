import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { RouterProvider } from "@tanstack/vue-router";
import { createVuetify } from "vuetify";
import { aliases as mdiAliases, mdi } from "vuetify/iconsets/mdi-svg";
import {
  mdiArrowLeftTopBold,
  mdiAccountOutline,
  mdiCogOutline,
  mdiGoogle,
  mdiHelpCircleOutline,
  mdiLogout,
  mdiShieldCrownOutline,
  mdiShapeOutline,
  mdiViewDashboardOutline
} from "@mdi/js";
import "vuetify/styles";
import { queryClient } from "./queryClient.js";
import { api } from "./services/api/index.js";
import { useAuthStore } from "./stores/authStore.js";
import { useGodStore } from "./stores/godStore.js";
import { useWorkspaceStore } from "./stores/workspaceStore.js";

const iconAliases = {
  ...mdiAliases,
  navChoice1: mdiViewDashboardOutline,
  navChoice2: mdiShapeOutline,
  menuProfile: mdiAccountOutline,
  menuSettings: mdiCogOutline,
  menuGoToAdmin: mdiShieldCrownOutline,
  menuBackToApp: mdiArrowLeftTopBold,
  menuHelp: mdiHelpCircleOutline,
  menuLogout: mdiLogout,
  oauthGoogle: mdiGoogle
};

function createVuetifyInstance() {
  return createVuetify({
    icons: {
      defaultSet: "mdi",
      aliases: iconAliases,
      sets: {
        mdi
      }
    },
    theme: {
      defaultTheme: "light",
      themes: {
        light: {
          colors: {
            primary: "#0f6b54",
            secondary: "#3f5150",
            background: "#eef3ee",
            surface: "#f7fbf6",
            "surface-variant": "#dfe8df",
            "on-surface-variant": "#3b4c44",
            error: "#9f1d1d"
          }
        },
        dark: {
          colors: {
            primary: "#6fd0b5",
            secondary: "#9db2af",
            background: "#0f1715",
            surface: "#16211e",
            "surface-variant": "#253430",
            "on-surface-variant": "#c5d6d2",
            error: "#ffb4ab"
          }
        }
      }
    }
  });
}

function applyThemePreference(vuetifyInstance, themePreference) {
  const preference = String(themePreference || "system").toLowerCase();
  if (preference === "dark") {
    vuetifyInstance.theme.global.name.value = "dark";
    return;
  }
  if (preference === "light") {
    vuetifyInstance.theme.global.name.value = "light";
    return;
  }

  const prefersDark =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  vuetifyInstance.theme.global.name.value = prefersDark ? "dark" : "light";
}

async function bootstrapRuntime({ authStore, workspaceStore, godStore, vuetify, surface }) {
  try {
    const bootstrapPayload = await api.workspace.bootstrap();
    const session =
      bootstrapPayload?.session && typeof bootstrapPayload.session === "object" ? bootstrapPayload.session : {};
    authStore.applySession({
      authenticated: Boolean(session.authenticated),
      username: session.username || null
    });
    workspaceStore.applyBootstrap(bootstrapPayload);

    applyThemePreference(vuetify, workspaceStore.userSettings?.theme);

    if (String(surface || "").trim() === "god" && authStore.isAuthenticated) {
      try {
        await godStore.refreshBootstrap();
      } catch (error) {
        if (Number(error?.status) === 403) {
          godStore.setForbidden();
        } else if (Number(error?.status) === 401) {
          authStore.setSignedOut();
          workspaceStore.clearWorkspaceState();
          godStore.clearGodState();
        } else {
          throw error;
        }
      }
    } else {
      godStore.clearGodState();
    }
  } catch {
    authStore.setSignedOut();
    workspaceStore.clearWorkspaceState();
    godStore.clearGodState();
    applyThemePreference(vuetify, "system");
  }
}

async function mountSurfaceApplication({ createRouter, surface }) {
  const pinia = createPinia();
  const authStore = useAuthStore(pinia);
  const godStore = useGodStore(pinia);
  const workspaceStore = useWorkspaceStore(pinia);
  const vuetify = createVuetifyInstance();

  await bootstrapRuntime({ authStore, workspaceStore, godStore, vuetify, surface });
  const router = createRouter({ authStore, workspaceStore, godStore });

  createApp({
    render: () => h(RouterProvider, { router })
  })
    .use(pinia)
    .use(VueQueryPlugin, { queryClient })
    .use(vuetify)
    .mount("#app");
}

export { mountSurfaceApplication };
