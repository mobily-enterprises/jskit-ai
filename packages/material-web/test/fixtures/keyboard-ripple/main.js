import { createApp, h, ref } from "vue";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components/VApp";
import { VBtn } from "vuetify/components/VBtn";
import { VCard, VCardItem, VCardText } from "vuetify/components/VCard";
import { VMain } from "vuetify/components/VMain";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// A card whose own Enter handler opens a panel and moves focus to its title at once, as mobilynet's map cards did, a
// control without a ripple that does the same, and a button pressed after them (keyboardRipple.browser.test.js). The
// handlers are attribute listeners, which Vue adds as it creates each element, before Vuetify's ripple directive adds
// its own on mounting. globalThis.blurs counts the blur events each control hears.
globalThis.blurs = { card: 0, plain: 0, title: 0, next: 0 };
const counted = (name) => () => {
  globalThis.blurs[name] += 1;
};

const App = {
  setup() {
    const opened = ref(0);
    const title = ref(null);
    const open = (event) => {
      if (event.key !== "Enter") return;
      opened.value += 1;
      title.value.focus();
    };
    return () => h(VApp, () => h(VMain, { class: "pa-6" }, () => [
      h(VCard, {
        link: true, role: "button", tabindex: 0, width: 320, onKeydown: open, onBlur: counted("card"), "data-testid": "card"
      }, () => [
        h(VCardItem, { title: "chat.example.com" }),
        h(VCardText, () => "Serves the chat app")
      ]),
      h("div", {
        class: "mt-6", role: "button", tabindex: 0, onKeydown: open, onBlur: counted("plain"), "data-testid": "plain"
      }, "Opens the panel, without a ripple"),
      h("section", { class: "mt-6" }, [
        h("h2", { ref: title, tabindex: -1, onBlur: counted("title"), "data-testid": "panel-title" }, `Opened ${opened.value} times`)
      ]),
      h(VBtn, { class: "mt-6", onBlur: counted("next"), "data-testid": "next" }, () => "Next")
    ]));
  }
};

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
