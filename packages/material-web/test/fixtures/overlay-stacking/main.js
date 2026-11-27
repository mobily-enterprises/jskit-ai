import { createApp, h } from "vue";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components/VApp";
import { VBtn } from "vuetify/components/VBtn";
import { VCard, VCardActions, VCardText } from "vuetify/components/VCard";
import { VDialog } from "vuetify/components/VDialog";
import { VMain } from "vuetify/components/VMain";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// A dialog open over a page whose content has a z-index of its own, with JSKIT's Material 3 options and stylesheet
// (overlayStacking.browser.test.js), as mobilynet's dialogs open over its pages: behind the dialog, forty lines of text
// in a bare div at `position: relative; z-index: 1`; in the dialog, a title, a line of text and two buttons, each
// text one line, so that the only thing axe can find over them is a box it ranks above the dialog.
const lines = Array.from({ length: 40 }, (_, index) => `Line ${index + 1} of the page behind the dialog, at z-index 1.`);

const page = () => h("div", { class: "pa-4" }, [
  h("h1", { class: "text-headline-small mb-2" }, "A page behind a dialog"),
  h("div", { style: "position: relative; z-index: 1", "data-testid": "page-behind" },
    lines.map((line) => h("p", { class: "text-body-large mb-1" }, line)))
]);

const dialog = () => h(VDialog, { modelValue: true, persistent: true, maxWidth: 560 }, () => (
  h(VCard, { title: "Edit the name", "data-testid": "dialog-card" }, () => [
    h(VCardText, null, () => "The name shows on every page of the project."),
    h(VCardActions, { class: "justify-end" }, () => [
      h(VBtn, { variant: "text" }, () => "Cancel"),
      h(VBtn, { variant: "text", color: "primary" }, () => "Save")
    ])
  ])
));

const App = () => h(VApp, () => h(VMain, () => [page(), dialog()]));

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
