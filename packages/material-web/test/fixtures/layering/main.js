import { createApp, h } from "vue";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components/VApp";
import { VAvatar } from "vuetify/components/VAvatar";
import { VBtn } from "vuetify/components/VBtn";
import { VCard, VCardText, VCardTitle } from "vuetify/components/VCard";
import { VChip } from "vuetify/components/VChip";
import { VList, VListItem } from "vuetify/components/VList";
import { VMain } from "vuetify/components/VMain";
import "vuetify/styles";
import "../../../src/client/material.css";
import { createMaterialVuetifyOptions } from "../../../src/client/index.js";

// A button, a chip, a list item, a card and an avatar, with JSKIT's Material 3 options and stylesheet, each holding
// in its content a mark placed absolutely at its top right corner, as an app places an attention dot or a badge on a
// control (layering.browser.test.js). The avatar's mark sits in a span of initials, the card's in its text, under its
// title.
const mark = (control) => h("span", {
  "data-testid": `${control}-mark`,
  style: "position: absolute; top: 0; right: 0; width: 6px; height: 6px; background: rgb(var(--v-theme-error))"
});

const controls = [
  h(VBtn, { width: 144, "data-testid": "button" }, () => ["Usage", mark("button")]),
  h(VChip, { "data-testid": "chip" }, () => ["Shared", mark("chip")]),
  h(VList, null, () => h(VListItem, { title: "Invoices", "data-testid": "list-item" }, () => mark("list-item"))),
  h(VCard, { width: 240, "data-testid": "card" }, () => [
    h(VCardTitle, null, () => "Quarterly report"),
    h(VCardText, null, () => ["Updated yesterday", mark("card")])
  ]),
  h(VAvatar, { color: "primary", "data-testid": "avatar" }, () => h("span", null, ["AB", mark("avatar")]))
];

const App = () => h(VApp, () => h(VMain, { class: "pa-6" }, () => controls.map((control) => h("div", { class: "mb-4" }, control))));

createApp(App).use(createVuetify(createMaterialVuetifyOptions())).mount("#app");
