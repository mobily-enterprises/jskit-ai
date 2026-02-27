import { createApp, defineComponent, h } from "vue";
import { RouterView } from "@tanstack/vue-router";
import { createShellRouter } from "./shell/router.js";

const RootView = defineComponent({
  name: "WebShellRootView",
  setup() {
    return () => h(RouterView);
  }
});

const router = createShellRouter();
createApp(RootView).use(router).mount("#app");
