import { bootWorkspaceDirectoryRoutes } from "./workspaceDirectory/bootWorkspaceDirectoryRoutes.js";
import { registerWorkspaceDirectory } from "./workspaceDirectory/registerWorkspaceDirectory.js";
import {
  registerWorkspacePendingInvitations
} from "./workspacePendingInvitations/registerWorkspacePendingInvitations.js";
import { bootWorkspacePendingInvitations } from "./workspacePendingInvitations/bootWorkspacePendingInvitations.js";
import { registerWorkspaceMembers } from "./workspaceMembers/registerWorkspaceMembers.js";
import { bootWorkspaceMembers } from "./workspaceMembers/bootWorkspaceMembers.js";
import { registerWorkspaceSettings } from "./workspaceSettings/registerWorkspaceSettings.js";
import { bootWorkspaceSettings } from "./workspaceSettings/bootWorkspaceSettings.js";
import { registerWorkspaceJsonRestResources } from "./common/registerJsonRestResources.js";
import { registerWorkspaceRepositories } from "./registerWorkspaceRepositories.js";
import { registerWorkspaceCore } from "./registerWorkspaceCore.js";
import { registerWorkspaceBootstrap } from "./registerWorkspaceBootstrap.js";

class WorkspacesCoreServiceProvider {
  static id = "workspaces.core";

  static dependsOn = ["users.core"];

  async register(app) {
    await registerWorkspaceJsonRestResources(app);
    registerWorkspaceRepositories(app);
    registerWorkspaceCore(app);
    registerWorkspaceBootstrap(app);
    registerWorkspaceDirectory(app);
    registerWorkspaceMembers(app);
    registerWorkspaceSettings(app);
    registerWorkspacePendingInvitations(app);
  }

  async boot(app) {
    if (app.make("workspaces.enabled") !== true) {
      return;
    }

    bootWorkspaceDirectoryRoutes(app);
    if (app.make("workspaces.invitations.enabled") === true) {
      bootWorkspacePendingInvitations(app);
    }
    bootWorkspaceSettings(app);
    bootWorkspaceMembers(app);
  }
}

export { WorkspacesCoreServiceProvider };
