import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createWorkspaceBootstrapContributor } from "./workspaceBootstrapContributor.js";
import { registerWorkspaceDirectoryRoutes } from "./workspaceDirectory/workspaceDirectoryRoutes.js";
import { createWorkspaceDirectoryActions } from "./workspaceDirectory/workspaceDirectoryActions.js";
import { registerWorkspaceMembersRoutes } from "./workspaceMembers/workspaceMembersRoutes.js";
import { createWorkspaceMembersActions } from "./workspaceMembers/workspaceMembersActions.js";
import { registerWorkspacePendingInvitationsRoutes } from "./workspacePendingInvitations/workspacePendingInvitationsRoutes.js";
import { createWorkspacePendingInvitationsActions } from "./workspacePendingInvitations/workspacePendingInvitationsActions.js";
import { registerWorkspaceSettingsRoutes } from "./workspaceSettings/workspaceSettingsRoutes.js";
import { unconfiguredWorkspaceInviteMailer } from "./workspaceMembers/unconfiguredWorkspaceInviteMailer.js";
import { renderDefaultWorkspaceInviteEmail } from "./workspaceMembers/defaultWorkspaceInviteEmail.js";
import { noInviteAcceptanceParticipant } from "./workspacePendingInvitations/noInviteAcceptanceParticipant.js";
import { buildWorkspaceName } from "./common/services/workspaceContextService.js";
import { createWorkspaceSettingsActions } from "./workspaceSettings/workspaceSettingsActions.js";
import { createWorkspacesRuntime, installWorkspaceResources } from "./workspacesRuntime.js";

const WorkspacesFeature = defineFeature({
  id: "workspaces.core",
  domain: "workspace",
  requires: {
    appRoot: "runtime.app-root",
    bootstrap: "runtime.bootstrap",
    config: "runtime.config",
    env: "runtime.env",
    http: "runtime.http",
    jsonRestApi: "runtime.json-rest-api",
    users: "users.core"
  },
  optional: {
    inviteAcceptanceParticipant: "workspaces.invite-acceptance-participant",
    inviteEmailTemplate: "workspaces.invite-email-template",
    inviteMailer: "workspaces.invite-mailer",
    personalWorkspaceName: "workspaces.personal-workspace-name"
  },
  provides: {
    workspaces: "workspaces.core"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} capabilities.appRoot
   * @param {import("@jskit-ai/kernel/server/types").RuntimeBootstrap} capabilities.bootstrap
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} capabilities.config
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("./types.js").WorkspaceInviteAcceptanceParticipant | null} capabilities.inviteAcceptanceParticipant
   * @param {import("./types.js").WorkspaceInviteEmailTemplate | null} capabilities.inviteEmailTemplate
   * @param {import("./types.js").WorkspaceInviteMailer | null} capabilities.inviteMailer
   * @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} capabilities.jsonRestApi
   * @param {import("./types.js").PersonalWorkspaceName | null} capabilities.personalWorkspaceName
   * @param {import("@jskit-ai/users-core/server/types").UsersCore} capabilities.users
   */
  async setup({
    appRoot,
    bootstrap,
    config,
    env,
    http,
    inviteAcceptanceParticipant,
    inviteEmailTemplate,
    inviteMailer,
    jsonRestApi,
    personalWorkspaceName,
    users
  }) {
    await installWorkspaceResources(jsonRestApi);
    const workspaces = createWorkspacesRuntime({
      appRoot,
      config,
      env,
      inviteAcceptanceParticipant: inviteAcceptanceParticipant ?? noInviteAcceptanceParticipant,
      inviteEmailTemplate: inviteEmailTemplate ?? renderDefaultWorkspaceInviteEmail,
      inviteMailer: inviteMailer ?? unconfiguredWorkspaceInviteMailer,
      jsonRestApi,
      personalWorkspaceName: personalWorkspaceName ?? buildWorkspaceName,
      users
    });

    bootstrap.register({
      id: "workspaces.bootstrap",
      order: 200,
      contribute: createWorkspaceBootstrapContributor({
        tenancyProfile: workspaces.tenancyProfile,
        userProfilesRepository: users.repositories.userProfiles,
        workspaceInvitationsEnabled: workspaces.invitationsEnabled,
        workspacePendingInvitationsService: workspaces.services.pendingInvitations,
        workspaceService: workspaces.services.directory
      }).contribute
    });

    if (workspaces.enabled) {
      registerWorkspaceDirectoryRoutes(http.router, {
        config,
        workspaceSelfCreateEnabled: workspaces.selfCreateEnabled
      });
      registerWorkspaceSettingsRoutes(http.router, { config });
      registerWorkspaceMembersRoutes(http.router, {
        config,
        workspaceInvitationsEnabled: workspaces.invitationsEnabled
      });
      if (workspaces.invitationsEnabled) {
        registerWorkspacePendingInvitationsRoutes(http.router);
      }
    }

    return { workspaces };
  },
  actions({ workspaces }) {
    if (!workspaces.enabled) return Object.freeze([]);
    return Object.freeze([
      ...createWorkspaceDirectoryActions({ workspaceService: workspaces.services.directory }),
      ...createWorkspaceSettingsActions({ workspaceSettingsService: workspaces.services.settings }),
      ...createWorkspaceMembersActions({ workspaceMembersService: workspaces.services.members }),
      ...(workspaces.invitationsEnabled
        ? createWorkspacePendingInvitationsActions({
            workspacePendingInvitationsService: workspaces.services.pendingInvitations
          })
        : [])
    ]);
  }
});

// Applications' tests build the runtime and install its resources directly, from
// this package's public feature path, with the optional tokens' defaults.
export {
  WorkspacesFeature,
  buildWorkspaceName,
  createWorkspacesRuntime,
  installWorkspaceResources,
  noInviteAcceptanceParticipant,
  renderDefaultWorkspaceInviteEmail,
  unconfiguredWorkspaceInviteMailer
};
