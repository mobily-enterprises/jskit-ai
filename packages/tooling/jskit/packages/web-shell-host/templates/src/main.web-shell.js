import { createApp, h } from "vue";
import { RouterProvider } from "@tanstack/vue-router";
import { createShellRouter } from "./shell/router.js";

const RootView = {
  name: "WebShellRootView",
  render() {
    return h(RouterProvider, { router });
  }
};

const router = createShellRouter();
createApp(RootView).mount("#app");
