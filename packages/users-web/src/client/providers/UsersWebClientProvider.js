import UsersWorkspaceSelector from "../components/UsersWorkspaceSelector.vue";
import UsersWorkspaceToolsWidget from "../components/UsersWorkspaceToolsWidget.vue";
import UsersShellMenuLinkItem from "../components/UsersShellMenuLinkItem.vue";
import UsersSurfaceAwareMenuLinkItem from "../components/UsersSurfaceAwareMenuLinkItem.vue";
import UsersWorkspaceSettingsMenuItem from "../components/UsersWorkspaceSettingsMenuItem.vue";
import UsersWorkspaceMembersMenuItem from "../components/UsersWorkspaceMembersMenuItem.vue";
import ProfileClientElement from "../components/ProfileClientElement.vue";
import MembersAdminClientElement from "../components/MembersAdminClientElement.vue";
import WorkspaceSettingsClientElement from "../components/WorkspaceSettingsClientElement.vue";
import {
  USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN,
  createBootstrapPlacementRuntime
} from "../runtime/bootstrapPlacementRuntime.js";

const USERS_WEB_WORKSPACE_SELECTOR_TOKEN = "users.web.workspace.selector";
const USERS_WEB_WORKSPACE_TOOLS_WIDGET_TOKEN = "users.web.workspace.tools.widget";
const USERS_WEB_SHELL_MENU_LINK_ITEM_TOKEN = "users.web.shell.menu-link-item";
const USERS_WEB_SURFACE_AWARE_MENU_LINK_ITEM_TOKEN = "users.web.shell.surface-aware-menu-link-item";
const USERS_WEB_WORKSPACE_SETTINGS_MENU_ITEM_TOKEN = "users.web.workspace-settings.menu-item";
const USERS_WEB_WORKSPACE_MEMBERS_MENU_ITEM_TOKEN = "users.web.workspace-members.menu-item";
const USERS_WEB_PROFILE_ELEMENT_TOKEN = "users.web.profile.element";
const USERS_WEB_MEMBERS_ADMIN_ELEMENT_TOKEN = "users.web.members-admin.element";
const USERS_WEB_WORKSPACE_SETTINGS_ELEMENT_TOKEN = "users.web.workspace-settings.element";

class UsersWebClientProvider {
  static id = "users.web.client";
  static dependsOn = ["shell.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("UsersWebClientProvider requires application singleton().");
    }

    app.singleton(USERS_WEB_WORKSPACE_SELECTOR_TOKEN, () => UsersWorkspaceSelector);
    app.singleton(USERS_WEB_WORKSPACE_TOOLS_WIDGET_TOKEN, () => UsersWorkspaceToolsWidget);
    app.singleton(USERS_WEB_SHELL_MENU_LINK_ITEM_TOKEN, () => UsersShellMenuLinkItem);
    app.singleton(USERS_WEB_SURFACE_AWARE_MENU_LINK_ITEM_TOKEN, () => UsersSurfaceAwareMenuLinkItem);
    app.singleton(USERS_WEB_WORKSPACE_SETTINGS_MENU_ITEM_TOKEN, () => UsersWorkspaceSettingsMenuItem);
    app.singleton(USERS_WEB_WORKSPACE_MEMBERS_MENU_ITEM_TOKEN, () => UsersWorkspaceMembersMenuItem);
    app.singleton(USERS_WEB_PROFILE_ELEMENT_TOKEN, () => ProfileClientElement);
    app.singleton(USERS_WEB_MEMBERS_ADMIN_ELEMENT_TOKEN, () => MembersAdminClientElement);
    app.singleton(USERS_WEB_WORKSPACE_SETTINGS_ELEMENT_TOKEN, () => WorkspaceSettingsClientElement);
    app.singleton(USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN, (scope) => createBootstrapPlacementRuntime({ app: scope }));
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("UsersWebClientProvider requires application make().");
    }

    const runtime = app.make(USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN);
    if (runtime && typeof runtime.initialize === "function") {
      await runtime.initialize();
    }
  }

  shutdown(app) {
    if (!app || typeof app.make !== "function") {
      return;
    }

    const runtime = app.make(USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN);
    if (runtime && typeof runtime.shutdown === "function") {
      runtime.shutdown();
    }
  }
}

export {
  UsersWebClientProvider,
  USERS_WEB_WORKSPACE_SELECTOR_TOKEN,
  USERS_WEB_WORKSPACE_TOOLS_WIDGET_TOKEN,
  USERS_WEB_SHELL_MENU_LINK_ITEM_TOKEN,
  USERS_WEB_SURFACE_AWARE_MENU_LINK_ITEM_TOKEN,
  USERS_WEB_WORKSPACE_SETTINGS_MENU_ITEM_TOKEN,
  USERS_WEB_WORKSPACE_MEMBERS_MENU_ITEM_TOKEN,
  USERS_WEB_PROFILE_ELEMENT_TOKEN,
  USERS_WEB_MEMBERS_ADMIN_ELEMENT_TOKEN,
  USERS_WEB_WORKSPACE_SETTINGS_ELEMENT_TOKEN,
  USERS_WEB_BOOTSTRAP_PLACEMENT_RUNTIME_TOKEN
};
