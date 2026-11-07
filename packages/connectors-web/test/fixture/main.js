import { createApp } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import "vuetify/styles";
import { registerJskitMessages } from "@jskit-ai/kernel/client";
import catalogEnglish from "../../../connectors-catalog/locales/en.json" with { type: "json" };
import calendarEnglish from "../../../connector-google-calendar/locales/en.json" with { type: "json" };
import App from "./App.vue";
import Vuetify23366 from "./Vuetify23366.vue";
import { createMaterialVuetifyOptions } from "../../../material-web/src/client/index.js";

// An app's generated bootstrap registers every installed package's English; the fixture does it by hand.
registerJskitMessages(catalogEnglish);
registerJskitMessages(calendarEnglish);

// `?vuetify=material` draws the form with JSKIT's Material 3 options and stylesheet, as an app does, and
// `?vuetify=vmenu-defaults` adds one VMenu sub-component default to them: the case under which Vuetify (4.2.1 to
// 4.3.2) loses a select's typeahead match when a panel around it re-renders (selectTypeahead.browser.test.js).
// `?fixture=vuetify-23366` shows that bug on its own instead of the forms.
const params = new URLSearchParams(window.location.search);
const vuetifyMode = params.get("vuetify");
let options = {};
if (vuetifyMode) {
  await import("../../../material-web/src/client/material.css");
  const material = createMaterialVuetifyOptions();
  options = vuetifyMode === "vmenu-defaults" ? { ...material, defaults: { ...material.defaults, VMenu: { VSheet: {} } } } : material;
}

createApp(params.get("fixture") === "vuetify-23366" ? Vuetify23366 : App).use(createVuetify({ components, directives, ...options })).mount("#app");
