import { createApp, h } from "vue";
import { createVuetify } from "vuetify";
import { VAlert } from "vuetify/components/VAlert";
import { VApp } from "vuetify/components/VApp";
import { VCard, VCardText } from "vuetify/components/VCard";
import { VDialog } from "vuetify/components/VDialog";
import { VMain } from "vuetify/components/VMain";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// A tonal alert in each colour with a container role, with JSKIT's Material 3 options and stylesheet, in the
// browser's light or dark scheme (tonalAlerts.browser.test.js), on the surface the page's ?surface= names: on the
// page, in a card (JSKIT's default, surface-container-low) or in a dialog's card (surface-container-high), one
// surface a page so that no alert lies under another surface's dialog or its scrim.
const COLORS = Object.freeze(["primary", "secondary", "tertiary", "error", "warning", "info", "success"]);
const surface = new URLSearchParams(globalThis.location.search).get("surface") || "page";

const alerts = () => COLORS.map((color) => h(VAlert, {
  variant: "tonal",
  color,
  title: `The ${color} alert`,
  text: `What the ${color} alert says.`,
  class: "mb-3",
  "data-testid": color
}));

const card = () => h(VCard, null, () => h(VCardText, null, alerts));

const App = () => h(VApp, () => h(VMain, { class: "pa-6" }, () => {
  if (surface === "card") return card();
  if (surface === "dialog") return h(VDialog, { modelValue: true, persistent: true, width: 560 }, card);
  return alerts();
}));

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
