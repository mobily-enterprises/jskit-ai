import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import DefaultLoginView from "../views/DefaultLoginView.vue";
import AuthProfileWidget from "../views/AuthProfileWidget.vue";
import AuthProfileMenuLinkItem from "../views/AuthProfileMenuLinkItem.vue";
import { useLoginView } from "../runtime/useLoginView.js";
import { createAuthClient, NO_AUTH_REALTIME } from "../runtime/authClient.js";

const AuthWebClientProvider = defineProvider({
  id: "auth.web.client",
  requires: {
    components: "client.components",
    pinia: "client.pinia",
    shell: "client.shell",
    vueApp: "client.vue"
  },
  optional: {
    mobile: "client.mobile",
    realtime: "client.realtime"
  },
  provides: {
    auth: "client.auth"
  },
  /**
   * @param {{
   *   components: import("@jskit-ai/kernel/client/types").ClientComponents,
   *   mobile: import("../types.js").AuthMobile | null,
   *   pinia: import("@jskit-ai/kernel/client/types").ClientPinia,
   *   realtime: import("../types.js").AuthRealtime | null,
   *   shell: import("../types.js").AuthShell,
   *   vueApp: import("@jskit-ai/kernel/client/types").ClientVueApp
   * }} capabilities
   */
  setup({ components, mobile, pinia, realtime, shell, vueApp }) {
    components.register("auth.login.component", DefaultLoginView);
    components.register("auth.login.useLoginView", useLoginView);
    components.register("auth.web.profile.widget", AuthProfileWidget);
    components.register("auth.web.profile.menu.link-item", AuthProfileMenuLinkItem);
    return {
      auth: createAuthClient({
        mobile,
        pinia,
        realtime: realtime ?? NO_AUTH_REALTIME,
        shell,
        vueApp
      })
    };
  },
  /** @param {unknown} _dependencies @param {{ outputs: { auth: import("../types.js").AuthClient } }} context */
  async boot(_dependencies, { outputs }) {
    await outputs.auth.initialize();
  },
  /** @param {unknown} _dependencies @param {{ outputs: { auth: import("../types.js").AuthClient } }} context */
  shutdown(_dependencies, { outputs }) {
    outputs.auth.dispose();
  }
});

export { AuthWebClientProvider };
