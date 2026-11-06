import { createApp } from "vue";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import App from "./App.vue";

const vuetify = createVuetify({
  components,
  directives,
  ...createMaterialVuetifyOptions()
});

createApp(App)
  .use(vuetify)
  .mount("#app");
