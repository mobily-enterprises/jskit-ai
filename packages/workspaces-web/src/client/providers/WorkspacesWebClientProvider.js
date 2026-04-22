import UsersProfileSurfaceSwitchMenuItem from "../components/UsersProfileSurfaceSwitchMenuItem.vue";
import UsersWorkspaceSelector from "../components/UsersWorkspaceSelector.vue";
import UsersWorkspaceToolsWidget from "../components/UsersWorkspaceToolsWidget.vue";
import UsersWorkspaceSettingsMenuItem from "../components/UsersWorkspaceSettingsMenuItem.vue";
import UsersWorkspaceMembersMenuItem from "../components/UsersWorkspaceMembersMenuItem.vue";
import MembersAdminClientElement from "../components/MembersAdminClientElement.vue";
import { createBootstrapPlacementRuntime } from "../runtime/bootstrapPlacementRuntime.js";
import {
  WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY,
  createWorkspaceScopeSupport
} from "../support/workspaceScopeSupport.js";

class WorkspacesWebClientProvider {
  static id = "workspaces.web.client";
  static dependsOn = ["users.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("WorkspacesWebClientProvider requires application singleton().");
    }

    app.singleton("workspaces.web.profile.menu.surface-switch-item", () => UsersProfileSurfaceSwitchMenuItem);
    app.singleton("workspaces.web.workspace.selector", () => UsersWorkspaceSelector);
    app.singleton("workspaces.web.workspace.tools.widget", () => UsersWorkspaceToolsWidget);
    app.singleton("workspaces.web.workspace-settings.menu-item", () => UsersWorkspaceSettingsMenuItem);
    app.singleton("workspaces.web.workspace-members.menu-item", () => UsersWorkspaceMembersMenuItem);
    app.singleton("workspaces.web.members-admin.element", () => MembersAdminClientElement);
    app.singleton("workspaces.web.bootstrap-placement.runtime", (scope) => createBootstrapPlacementRuntime({ app: scope }));
    app.singleton("workspaces.web.scope-support", () => createWorkspaceScopeSupport());
  }

  async boot(app) {
    if (!app || typeof app.make !== "function") {
      throw new Error("WorkspacesWebClientProvider boot requires application make().");
    }

    const runtime = app.make("workspaces.web.bootstrap-placement.runtime");
    if (runtime && typeof runtime.initialize === "function") {
      await runtime.initialize();
    }

    if (!app.has("jskit.client.vue.app")) {
      return;
    }

    const vueApp = app.make("jskit.client.vue.app");
    if (!vueApp || typeof vueApp.provide !== "function") {
      return;
    }

    vueApp.provide(
      WORKSPACES_WEB_SCOPE_SUPPORT_INJECTION_KEY,
      app.make("workspaces.web.scope-support")
    );
  }

  shutdown(app) {
    if (!app || typeof app.make !== "function") {
      return;
    }

    const runtime = app.make("workspaces.web.bootstrap-placement.runtime");
    if (runtime && typeof runtime.shutdown === "function") {
      runtime.shutdown();
    }
  }
}

export { WorkspacesWebClientProvider };
