import { createApp } from "vue";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import App from "./App.vue";
import ConversationFixture from "./ConversationFixture.vue";
import ProgressFixture from "./ProgressFixture.vue";
import DeliveryFixture from "./DeliveryFixture.vue";

const query = new URLSearchParams(location.search);
const material = createMaterialVuetifyOptions();
const vuetify = createVuetify({
  components,
  directives,
  ...material,
  theme: {
    ...material.theme,
    defaultTheme: query.has("dark") ? "dark" : "light"
  }
});

createApp(query.has("delivery") ? DeliveryFixture : query.has("progress") ? ProgressFixture : query.has("conversation") ? ConversationFixture : App)
  .use(vuetify)
  .mount("#app");
