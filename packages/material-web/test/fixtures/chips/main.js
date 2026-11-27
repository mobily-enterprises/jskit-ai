import { createApp, h } from "vue";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components/VApp";
import { VChip } from "vuetify/components/VChip";
import { VIcon } from "vuetify/components/VIcon";
import { VMain } from "vuetify/components/VMain";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// Chips in a column narrower than a long label, with JSKIT's Material 3 options and stylesheet, as an app draws them
// (chips.browser.test.js): a long label on a chip and on a chip you press (whose touch target unclips it), a short one,
// a short one with a leading icon, and one whose label holds an element of its own (an icon in its default slot).
const LONG = "Quarterly invoices for the North Atlantic shipping project, second half";
const chips = [
  { testId: "long-chip", props: { text: LONG } },
  { testId: "long-pressable-chip", props: { text: LONG, link: true } },
  { testId: "short-chip", props: { text: "Draft" } },
  { testId: "icon-chip", props: { text: "Shared", prependIcon: "$info" } },
  { testId: "slot-chip", props: {}, label: () => [h(VIcon, { icon: "$info", start: true }), "Shared"] }
];

const App = () => h(VApp, () => h(VMain, { class: "pa-6" }, () => h("div", { style: "width: 240px", "data-testid": "column" }, (
  chips.map(({ testId, props, label }) => h("div", { class: "mb-2" }, h(VChip, { ...props, "data-testid": testId }, label)))
))));

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
