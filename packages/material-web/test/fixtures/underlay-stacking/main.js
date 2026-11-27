import { createApp, h } from "vue";
import { createVuetify } from "vuetify";
import { VAlert } from "vuetify/components/VAlert";
import { VApp } from "vuetify/components/VApp";
import { VIconBtn } from "vuetify/components/VIconBtn";
import { VMain } from "vuetify/components/VMain";
import { VProgressCircular } from "vuetify/components/VProgressCircular";
import { VSnackbar } from "vuetify/components/VSnackbar";
import { VStepper } from "vuetify/components/VStepper";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// Each Vuetify component that draws a layer of its own over its text, beyond the button, chip, list item, card and
// avatar material.css already restacks, with JSKIT's Material 3 options and stylesheet
// (underlayStacking.browser.test.js): a tonal alert (its tint), an alert with a border (its border box), icon buttons
// with a text at rest, tonal and active (their state layer and underlay), an editable stepper's step (its state layer
// and underlay), a tonal snackbar (its tint) and a circular progress with a reading (its ring's svg).
const App = () => h(VApp, () => h(VMain, { class: "pa-6" }, () => [
  h(VAlert, {
    variant: "tonal",
    color: "primary",
    title: "Backups",
    text: "The last backup finished an hour ago.",
    class: "mb-4",
    "data-testid": "tonal-alert"
  }),
  h(VAlert, { border: "start", text: "Two-step sign-in is on.", class: "mb-4", "data-testid": "border-alert" }),
  h("div", { class: "d-flex ga-4 mb-4" }, [
    h(VIconBtn, { text: "Edit", width: 96, "data-testid": "icon-button" }),
    h(VIconBtn, { text: "Copy", variant: "tonal", width: 96, "data-testid": "tonal-icon-button" }),
    h(VIconBtn, { text: "Pinned", active: true, width: 96, "data-testid": "active-icon-button" })
  ]),
  h(VStepper, { modelValue: 1, editable: true, hideActions: true, items: ["Shipping"], class: "mb-4", "data-testid": "stepper" }),
  h(VProgressCircular, { modelValue: 75, size: 72, width: 6, "data-testid": "progress" }, () => "75%"),
  h(VSnackbar, { modelValue: true, variant: "tonal", timeout: -1, text: "Saved the report.", "data-testid": "snackbar" })
]));

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
