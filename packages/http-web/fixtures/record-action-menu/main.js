import { createApp } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import App from "./App.vue";

const page = { render: () => null };
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", component: page },
    { path: "/books/:bookId", component: page },
    { path: "/books/:bookId/edit", component: page }
  ]
});

const vuetify = createVuetify({
  components,
  directives,
  ...createMaterialVuetifyOptions()
});

await router.push("/");
createApp(App)
  .use(router)
  .use(vuetify)
  .mount("#app");
