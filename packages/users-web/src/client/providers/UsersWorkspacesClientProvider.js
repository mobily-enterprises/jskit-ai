import UsersWorkspaceSelector from "../components/UsersWorkspaceSelector.vue";
import UsersWorkspaceToolsWidget from "../components/UsersWorkspaceToolsWidget.vue";
import UsersWorkspaceSettingsMenuItem from "../components/UsersWorkspaceSettingsMenuItem.vue";
import UsersWorkspaceMembersMenuItem from "../components/UsersWorkspaceMembersMenuItem.vue";
import MembersAdminClientElement from "../components/MembersAdminClientElement.vue";

class UsersWorkspacesClientProvider {
  static id = "workspaces.web.client";
  static dependsOn = ["users.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("UsersWorkspacesClientProvider requires application singleton().");
    }

    app.singleton("users.web.workspace.selector", () => UsersWorkspaceSelector);
    app.singleton("users.web.workspace.tools.widget", () => UsersWorkspaceToolsWidget);
    app.singleton("users.web.workspace-settings.menu-item", () => UsersWorkspaceSettingsMenuItem);
    app.singleton("users.web.workspace-members.menu-item", () => UsersWorkspaceMembersMenuItem);
    app.singleton("users.web.members-admin.element", () => MembersAdminClientElement);
  }
}

export { UsersWorkspacesClientProvider };
