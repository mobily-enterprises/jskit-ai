import {
  INTERNAL_JSON_REST_API,
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
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
import { workspaceResource } from "../shared/resources/workspaceResource.js";
import { workspaceMembershipsResource } from "../shared/resources/workspaceMembershipsResource.js";
import { workspaceInvitesResource } from "../shared/resources/workspaceInvitesResource.js";
import { workspaceSettingsResource } from "../shared/resources/workspaceSettingsResource.js";

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
    const scopeOptions = {
      writeSerializers: {
        "datetime-utc": toDatabaseDateTimeUtc
      }
    };
    await addResourceIfMissing(api, "workspaces", createJsonRestResourceScopeOptions(workspaceResource, scopeOptions));
    await addResourceIfMissing(api, "workspaceMemberships", createJsonRestResourceScopeOptions(workspaceMembershipsResource, scopeOptions));
    await addResourceIfMissing(api, "workspaceInvites", createJsonRestResourceScopeOptions(workspaceInvitesResource, scopeOptions));
    await addResourceIfMissing(api, "workspaceSettings", createJsonRestResourceScopeOptions(workspaceSettingsResource, scopeOptions));
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
