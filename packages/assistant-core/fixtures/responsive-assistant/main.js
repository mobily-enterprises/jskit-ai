import { createApp } from "vue";
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases as mdiAliases, mdi } from "vuetify/iconsets/mdi-svg";
import App from "./App.vue";
import ConversationFixture from "./ConversationFixture.vue";

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

createApp(new URLSearchParams(location.search).has("conversation") ? ConversationFixture : App)
  .use(vuetify)
  .mount("#app");
