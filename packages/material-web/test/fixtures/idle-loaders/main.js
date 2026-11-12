import { createApp } from "vue";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components/VApp";
import { VProgressCircular } from "vuetify/components/VProgressCircular";
import { VProgressLinear } from "vuetify/components/VProgressLinear";
import { VTextField } from "vuetify/components/VTextField";
import "vuetify/styles";
import App from "./App.vue";

createApp(App).use(createVuetify({ components: { VApp, VProgressCircular, VProgressLinear, VTextField } })).mount("#app");
