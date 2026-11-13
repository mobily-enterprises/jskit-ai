import { createApp, h } from "vue";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components/VApp";
import { VMain } from "vuetify/components/VMain";
import { VRangeSlider } from "vuetify/components/VRangeSlider";
import { VSlider } from "vuetify/components/VSlider";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// A slider, a range slider and a disabled slider with JSKIT's Material 3 options and stylesheet, as an app draws them,
// in the browser's light or dark scheme (sliders.browser.test.js).
const sliders = [
  { testId: "slider", component: VSlider, props: { label: "Slider", modelValue: 40 } },
  { testId: "range-slider", component: VRangeSlider, props: { label: "Range", modelValue: [20, 70] } },
  { testId: "disabled-slider", component: VSlider, props: { label: "Disabled", modelValue: 40, disabled: true } }
];

const App = () => h(VApp, () => h(VMain, { class: "pa-6" }, () => sliders.map(({ testId, component, props }) => (
  h("div", { "data-testid": testId }, h(component, props))
))));

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
