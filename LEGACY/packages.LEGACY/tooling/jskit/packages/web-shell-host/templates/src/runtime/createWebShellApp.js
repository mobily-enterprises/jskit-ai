import { createApp, h } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { RouterProvider } from "@tanstack/vue-router";
import { createVuetify } from "vuetify";
import { aliases as mdiAliases, mdi } from "vuetify/iconsets/mdi-svg";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import {
  mdiAccountMultipleOutline,
  mdiAlertCircleOutline,
  mdiBellOutline,
  mdiCogOutline,
  mdiHomeOutline,
  mdiServer,
  mdiViewDashboardOutline
} from "@mdi/js";
import "vuetify/styles";

function createWebShellApp({ router }) {
  if (!router) {
    throw new Error("createWebShellApp requires router.");
  }

  const RootView = {
    name: "WebShellRootView",
    render() {
      return h(RouterProvider, { router });
    }
  };

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60000,
        gcTime: 300000,
        refetchOnWindowFocus: false
      },
      mutations: {
        retry: false
      }
    }
  });

  const vuetify = createVuetify({
    components,
    directives,
    icons: {
      defaultSet: "mdi",
      aliases: {
        ...mdiAliases,
        consoleBrowserErrors: mdiAlertCircleOutline,
        consoleServerErrors: mdiServer,
        console: mdiViewDashboardOutline,
        dashboard: mdiViewDashboardOutline,
        home: mdiHomeOutline,
        menuAlerts: mdiBellOutline,
        menuSettings: mdiCogOutline,
        navHome: mdiHomeOutline,
        navDashboard: mdiViewDashboardOutline,
        settings: mdiCogOutline,
        workspace: mdiAccountMultipleOutline
      },
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

  return createApp(RootView).use(VueQueryPlugin, { queryClient }).use(vuetify).mount("#app");
}

export { createWebShellApp };
