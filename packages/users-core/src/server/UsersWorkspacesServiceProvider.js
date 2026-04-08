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
import { registerWorkspaceRepositories } from "./registerWorkspaceRepositories.js";
import { registerWorkspaceCore } from "./registerWorkspaceCore.js";
import { registerWorkspaceBootstrap } from "./registerWorkspaceBootstrap.js";
import { registerUsersCoreActionSurfaceSources } from "./support/workspaceActionSurfaces.js";

class UsersWorkspacesServiceProvider {
  static id = "workspaces.core";

  static dependsOn = ["users.core"];

  register(app) {
    registerUsersCoreActionSurfaceSources(app);
    registerWorkspaceRepositories(app);
    registerWorkspaceCore(app);
    registerWorkspaceBootstrap(app);
    registerWorkspaceDirectory(app);
    registerWorkspaceMembers(app);
    registerWorkspaceSettings(app);
    registerWorkspacePendingInvitations(app);
  }

  async boot(app) {
    if (app.make("users.workspace.enabled") !== true) {
      return;
    }

    bootWorkspaceDirectoryRoutes(app);
    if (app.make("users.workspace.invitations.enabled") === true) {
      bootWorkspacePendingInvitations(app);
    }
    bootWorkspaceSettings(app);
    bootWorkspaceMembers(app);
  }
}

export { UsersWorkspacesServiceProvider };
