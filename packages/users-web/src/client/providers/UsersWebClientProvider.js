import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import UsersHomeToolsWidget from "../components/UsersHomeToolsWidget.vue";
import ProfileClientElement from "../components/ProfileClientElement.vue";
import { createUsersBootstrapUserHandler } from "../bootstrap/user-bootstrap-handler.js";

const UsersWebClientProvider = defineProvider({
  id: "users.web.client",
  requires: {
    components: "client.components",
    shell: "client.shell"
  },
  /**
   * @param {{
   *   components: import("@jskit-ai/kernel/client/types").ClientComponents,
   *   shell: import("../types.js").UsersShell
   * }} capabilities
   */
  setup({ components, shell }) {
    components.register("users.web.home.tools.widget", UsersHomeToolsWidget);
    components.register("users.web.profile.element", ProfileClientElement);
    shell.bootstrapHandlers.register(createUsersBootstrapUserHandler());
  }
});

export { UsersWebClientProvider };
