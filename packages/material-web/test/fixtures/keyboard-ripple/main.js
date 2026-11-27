import { createApp, h, ref } from "vue";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components/VApp";
import { VBtn } from "vuetify/components/VBtn";
import { VCard, VCardItem, VCardText } from "vuetify/components/VCard";
import { VMain } from "vuetify/components/VMain";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// A card whose own Enter handler opens a panel and moves focus to its title at once, as mobilynet's map cards did, and
// a button pressed after it (keyboardRipple.browser.test.js). The card's handler is an attribute listener, which Vue
// adds as it creates the element, before Vuetify's ripple directive adds its own on mounting.
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
      h(VCard, { link: true, role: "button", tabindex: 0, width: 320, onKeydown: open, "data-testid": "card" }, () => [
        h(VCardItem, { title: "chat.example.com" }),
        h(VCardText, () => "Serves the chat app")
      ]),
      h("section", { class: "mt-6" }, [
        h("h2", { ref: title, tabindex: -1, "data-testid": "panel-title" }, `Opened ${opened.value} times`)
      ]),
      h(VBtn, { class: "mt-6", "data-testid": "next" }, () => "Next")
    ]));
  }
};

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
