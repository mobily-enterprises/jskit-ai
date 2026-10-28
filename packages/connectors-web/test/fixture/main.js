import { createApp } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import "vuetify/styles";
import { registerJskitMessages } from "@jskit-ai/kernel/client";
import catalogEnglish from "../../../connectors-catalog/locales/en.json" with { type: "json" };
import calendarEnglish from "../../../connector-google-calendar/locales/en.json" with { type: "json" };
import App from "./App.vue";

// An app's generated bootstrap registers every installed package's English; the fixture does it by hand.
registerJskitMessages(catalogEnglish);
registerJskitMessages(calendarEnglish);

createApp(App).use(createVuetify({ components, directives })).mount("#app");
