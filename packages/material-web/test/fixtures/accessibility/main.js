import { createApp, h } from "vue";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components/VApp";
import { VBtn } from "vuetify/components/VBtn";
import { VCard, VCardItem, VCardSubtitle, VCardText, VCardTitle } from "vuetify/components/VCard";
import { VIcon } from "vuetify/components/VIcon";
import { VMain } from "vuetify/components/VMain";
import { VTextField } from "vuetify/components/VTextField";
import { VTooltip } from "vuetify/components/VTooltip";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// What axe measures on an app's screens, with JSKIT's Material 3 options and stylesheet, as an app draws them, in the
// browser's light or dark scheme (accessibility.browser.test.js):
// - an icon button with Vuetify's tooltip as its own child, as the shell's menu control has; the tooltip keeps
//   Vuetify's defaults, so it is mounted before it first shows;
// - cards with a title and a subtitle: JSKIT's default (flat on surface-container-low), another surface container,
//   one without a colour, a coloured one, a tonal one (its colour is its text colour) and a default one whose subtitle
//   has a colour class of its own;
// - text fields with a character counter on a dialog's surface-container-high: a valid one, an invalid one, one past
//   its limit and a disabled one.
const cards = [
  { testId: "default-card", props: {} },
  { testId: "surface-card", props: { color: "surface-container-high" } },
  { testId: "uncoloured-card", props: { color: null } },
  { testId: "primary-card", props: { color: "primary" } },
  { testId: "tonal-card", props: { color: "primary", variant: "tonal" } },
  { testId: "subtitle-class-card", props: {}, subtitleClass: "text-error" }
];

const fields = [
  { testId: "counter-field", props: { label: "Name", modelValue: "Ana" } },
  { testId: "invalid-counter-field", props: { label: "Code", modelValue: "AB", errorMessages: ["Use four letters"] } },
  { testId: "over-counter-field", props: { label: "Initials", modelValue: "ABCDEFG", counter: 4 } },
  { testId: "disabled-counter-field", props: { label: "Team", modelValue: "Blue", disabled: true } }
];

const tooltipButton = () => h(VBtn, { icon: true, variant: "text", "aria-label": "Delete", "data-testid": "tooltip-activator" }, () => [
  h(VIcon, { icon: "$delete" }),
  h(VTooltip, { activator: "parent", location: "bottom", text: "Delete this report" })
]);

const card = ({ testId, props, subtitleClass }) => h(VCard, { ...props, class: "mb-4", "data-testid": testId }, () => (
  h(VCardItem, null, () => [
    h(VCardTitle, null, () => "Quarterly report"),
    h(VCardSubtitle, { class: subtitleClass }, () => "Updated yesterday")
  ])
));

const fieldsCard = () => h(VCard, { color: "surface-container-high", "data-testid": "fields-card" }, () => (
  h(VCardText, null, () => fields.map(({ testId, props }) => (
    h(VTextField, { counter: 20, persistentCounter: true, ...props, "data-testid": testId })
  )))
));

const App = () => h(VApp, () => h(VMain, { class: "pa-6" }, () => [
  h("div", { class: "mb-6" }, tooltipButton()),
  ...cards.map(card),
  fieldsCard()
]));

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
