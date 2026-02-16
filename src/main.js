import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { RouterProvider } from "@tanstack/vue-router";
import { createVuetify } from "vuetify";
import { aliases as mdiAliases, mdi } from "vuetify/iconsets/mdi-svg";
import {
  mdiAccountOutline,
  mdiCogOutline,
  mdiGoogle,
  mdiHelpCircleOutline,
  mdiLogout,
  mdiShapeOutline,
  mdiViewDashboardOutline
} from "@mdi/js";
import "vuetify/styles";
import { queryClient } from "./queryClient";
import { useAuthStore } from "./stores/authStore";
import { createAppRouter } from "./router";

const pinia = createPinia();
const authStore = useAuthStore(pinia);
const router = createAppRouter(authStore);
const iconAliases = {
  ...mdiAliases,
  navChoice1: mdiViewDashboardOutline,
  navChoice2: mdiShapeOutline,
  menuProfile: mdiAccountOutline,
  menuSettings: mdiCogOutline,
  menuHelp: mdiHelpCircleOutline,
  menuLogout: mdiLogout,
  oauthGoogle: mdiGoogle
};

const vuetify = createVuetify({
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

createApp({
  render: () => h(RouterProvider, { router })
})
  .use(pinia)
  .use(VueQueryPlugin, { queryClient })
  .use(vuetify)
  .mount("#app");
