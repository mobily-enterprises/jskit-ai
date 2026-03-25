import UsersWorkspaceSelector from "../components/UsersWorkspaceSelector.vue";
import UsersWorkspaceToolsWidget from "../components/UsersWorkspaceToolsWidget.vue";
import UsersShellMenuLinkItem from "../components/UsersShellMenuLinkItem.vue";
import UsersSurfaceAwareMenuLinkItem from "../components/UsersSurfaceAwareMenuLinkItem.vue";
import UsersProfileSurfaceSwitchMenuItem from "../components/UsersProfileSurfaceSwitchMenuItem.vue";
import UsersWorkspaceSettingsMenuItem from "../components/UsersWorkspaceSettingsMenuItem.vue";
import UsersWorkspaceMembersMenuItem from "../components/UsersWorkspaceMembersMenuItem.vue";
import ProfileClientElement from "../components/ProfileClientElement.vue";
import MembersAdminClientElement from "../components/MembersAdminClientElement.vue";
import WorkspaceSettingsClientElement from "../components/WorkspaceSettingsClientElement.vue";
import {
  createBootstrapPlacementRuntime
} from "../runtime/bootstrapPlacementRuntime.js";

class UsersWebClientProvider {
  static id = "users.web.client";
  static dependsOn = ["shell.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("UsersWebClientProvider requires application singleton().");
    }

    app.singleton("users.web.workspace.selector", () => UsersWorkspaceSelector);
    app.singleton("users.web.workspace.tools.widget", () => UsersWorkspaceToolsWidget);
    app.singleton("users.web.shell.menu-link-item", () => UsersShellMenuLinkItem);
    app.singleton("users.web.shell.surface-aware-menu-link-item", () => UsersSurfaceAwareMenuLinkItem);
    app.singleton("users.web.profile.menu.surface-switch-item", () => UsersProfileSurfaceSwitchMenuItem);
    app.singleton("users.web.workspace-settings.menu-item", () => UsersWorkspaceSettingsMenuItem);
    app.singleton("users.web.workspace-members.menu-item", () => UsersWorkspaceMembersMenuItem);
    app.singleton("users.web.profile.element", () => ProfileClientElement);
    app.singleton("users.web.members-admin.element", () => MembersAdminClientElement);
    app.singleton("users.web.workspace-settings.element", () => WorkspaceSettingsClientElement);
    app.singleton("users.web.bootstrap-placement.runtime", (scope) => createBootstrapPlacementRuntime({ app: scope }));
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("UsersWebClientProvider requires application make().");
    }

    const runtime = app.make("users.web.bootstrap-placement.runtime");
    if (runtime && typeof runtime.initialize === "function") {
      await runtime.initialize();
    }
  }

  shutdown(app) {
    if (!app || typeof app.make !== "function") {
      return;
    }

    const runtime = app.make("users.web.bootstrap-placement.runtime");
    if (runtime && typeof runtime.shutdown === "function") {
      runtime.shutdown();
    }
  }
}

export { UsersWebClientProvider };
