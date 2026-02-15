import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { RouterProvider } from "@tanstack/vue-router";
import { createVuetify } from "vuetify";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import "vuetify/styles";
import { queryClient } from "./queryClient";
import { useAuthStore } from "./stores/authStore";
import { createAppRouter } from "./router";

const pinia = createPinia();
const authStore = useAuthStore(pinia);
const router = createAppRouter(authStore);

const vuetify = createVuetify({
  icons: {
    defaultSet: "mdi",
    aliases,
    sets: {
      mdi
    }
  },
  theme: {
    defaultTheme: "light",
    themes: {
      light: {
        colors: {
          primary: "#00684a",
          secondary: "#274042",
          background: "#f3f4ee",
          surface: "#ffffff",
          error: "#9f1d1d"
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
