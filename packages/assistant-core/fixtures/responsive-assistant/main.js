import { createApp } from "vue";
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases as mdiAliases, mdi } from "vuetify/iconsets/mdi-svg";
import App from "./App.vue";
import ConversationFixture from "./ConversationFixture.vue";
import ProgressFixture from "./ProgressFixture.vue";

const vuetify = createVuetify({
  components,
  directives,
  icons: {
    defaultSet: "mdi",
    aliases: mdiAliases,
    sets: { mdi }
  },
  theme: {
    defaultTheme: "light"
  }
});

const query = new URLSearchParams(location.search);
createApp(query.has("progress") ? ProgressFixture : query.has("conversation") ? ConversationFixture : App)
  .use(vuetify)
  .mount("#app");
