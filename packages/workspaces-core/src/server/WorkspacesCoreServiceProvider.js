import { INTERNAL_JSON_REST_API, addResourceIfMissing } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
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
import { workspacesResource } from "./common/resources/workspacesResource.js";
import { workspaceMembershipsResource } from "./common/resources/workspaceMembershipsResource.js";
import { workspaceInvitesResource } from "./common/resources/workspaceInvitesResource.js";
import { workspaceSettingsResource } from "./common/resources/workspaceSettingsResource.js";
import { registerWorkspaceRepositories } from "./registerWorkspaceRepositories.js";
import { registerWorkspaceCore } from "./registerWorkspaceCore.js";
import { registerWorkspaceBootstrap } from "./registerWorkspaceBootstrap.js";

class WorkspacesCoreServiceProvider {
  static id = "workspaces.core";

  static dependsOn = ["users.core", "json-rest-api.core"];

  async register(app) {
    registerWorkspaceRepositories(app);
    registerWorkspaceCore(app);
    registerWorkspaceBootstrap(app);
    registerWorkspaceDirectory(app);
    registerWorkspaceMembers(app);
    registerWorkspaceSettings(app);
    registerWorkspacePendingInvitations(app);
  }

  async boot(app) {
    const api = app.make(INTERNAL_JSON_REST_API);
    await addResourceIfMissing(api, "workspaces", workspacesResource);
    await addResourceIfMissing(api, "workspaceMemberships", workspaceMembershipsResource);
    await addResourceIfMissing(api, "workspaceInvites", workspaceInvitesResource);
    await addResourceIfMissing(api, "workspaceSettings", workspaceSettingsResource);
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
