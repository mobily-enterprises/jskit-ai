import { createApp, h } from "vue";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components/VApp";
import { VCard } from "vuetify/components/VCard";
import { VMain } from "vuetify/components/VMain";
import { VProgressLinear } from "vuetify/components/VProgressLinear";
import { VSkeletonLoader } from "vuetify/components/VSkeletonLoader";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// Skeleton loaders and linear progress indicators with JSKIT's Material 3 options and stylesheet, as an app draws them,
// in the browser's light or dark scheme (loading.browser.test.js). The first loader is the reported one, a transparent
// list row on a card; the second has every other bone Vuetify colours (image, heading, button, chip, divider, ossein).
const parts = [
  {
    testId: "list-row",
    component: VSkeletonLoader,
    props: { type: "list-item-avatar-two-line", color: "transparent" },
    card: true
  },
  { testId: "bones", component: VSkeletonLoader, props: { type: "card, actions, chip, divider, ossein", height: 360 } },
  { testId: "progress", component: VProgressLinear, props: { modelValue: 40, color: "primary" } },
  { testId: "progress-tertiary", component: VProgressLinear, props: { modelValue: 40, color: "tertiary" } },
  { testId: "progress-indeterminate", component: VProgressLinear, props: { indeterminate: true, color: "primary" } },
  { testId: "progress-wavy", component: VProgressLinear, props: { modelValue: 40, color: "primary", shape: "wavy" } }
];

const App = () => h(VApp, () => h(VMain, { class: "pa-6" }, () => parts.map(({ testId, component, props, card }) => {
  const part = h(component, props);
  return h("div", { "data-testid": testId, class: "mb-6" }, card ? h(VCard, () => part) : part);
})));

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
