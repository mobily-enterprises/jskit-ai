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
import { createAppEnvironmentInviteMailer } from "./workspaceMembers/appEnvironmentInviteMailer.js";
import { renderDefaultWorkspaceInviteEmail } from "./workspaceMembers/defaultWorkspaceInviteEmail.js";
import { noInviteAcceptanceParticipant } from "./workspacePendingInvitations/noInviteAcceptanceParticipant.js";
import { noWorkspaceCreatedParticipant } from "./workspaceDirectory/noWorkspaceCreatedParticipant.js";
import { buildWorkspaceName } from "./common/services/workspaceDirectoryService.js";
import { createWorkspaceSettingsActions } from "./workspaceSettings/workspaceSettingsActions.js";
import { WORKSPACES_TABLES, createWorkspaceRecords, createWorkspacesRuntime } from "./workspacesRuntime.js";

const WorkspacesFeature = defineFeature({
  id: "workspaces.core",
  domain: "workspace",
  owns: WORKSPACES_TABLES,
  requires: {
    appRoot: "runtime.app-root",
    bootstrap: "runtime.bootstrap",
    config: "runtime.config",
    env: "runtime.env",
    http: "runtime.http",
    logger: "runtime.logger",
    userProfiles: "users.profiles",
    userSettings: "users.settings"
  },
  optional: {
    inviteAcceptanceParticipant: "workspaces.invite-acceptance-participant",
    inviteEmailTemplate: "workspaces.invite-email-template",
    inviteMailer: "workspaces.invite-mailer",
    personalWorkspaceName: "workspaces.personal-workspace-name",
    workspaceCreatedParticipant: "workspaces.workspace-created-participant"
  },
  provides: {
    workspaces: "workspaces.core",
    workspaceRecords: "workspaces",
    workspaceMemberships: "workspaces.memberships"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} capabilities.appRoot
   * @param {import("@jskit-ai/kernel/server/types").RuntimeBootstrap} capabilities.bootstrap
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} capabilities.config
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} capabilities.logger
   * @param {import("./types.js").WorkspaceInviteAcceptanceParticipant | null} capabilities.inviteAcceptanceParticipant
   * @param {import("./types.js").WorkspaceInviteEmailTemplate | null} capabilities.inviteEmailTemplate
   * @param {import("./types.js").WorkspaceInviteMailer | null} capabilities.inviteMailer
   * @param {import("./types.js").PersonalWorkspaceName | null} capabilities.personalWorkspaceName
   * @param {import("./types.js").WorkspacesResources} capabilities.resources
   * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} capabilities.userProfiles
   * @param {import("@jskit-ai/users-core/server/types").UsersSettings} capabilities.userSettings
   * @param {import("./types.js").WorkspaceCreatedParticipant | null} capabilities.workspaceCreatedParticipant
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
    logger,
    personalWorkspaceName,
    resources,
    userProfiles,
    userSettings,
    workspaceCreatedParticipant
  }) {
    const records = createWorkspaceRecords(resources);
    const workspaces = createWorkspacesRuntime({
      appRoot,
      config,
      env,
      inviteAcceptanceParticipant: inviteAcceptanceParticipant ?? noInviteAcceptanceParticipant,
      inviteEmailTemplate: inviteEmailTemplate ?? renderDefaultWorkspaceInviteEmail,
      // A provided mailer sends as APP_ENV says: only production sends each invitation to its address.
      inviteMailer: inviteMailer
        ? createAppEnvironmentInviteMailer({ env, logger, mailer: inviteMailer })
        : unconfiguredWorkspaceInviteMailer,
      personalWorkspaceName: personalWorkspaceName ?? buildWorkspaceName,
      resources,
      userProfiles,
      userSettings,
      workspaceCreatedParticipant: workspaceCreatedParticipant ?? noWorkspaceCreatedParticipant,
      workspaces: records.workspaces,
      workspaceMemberships: records.memberships
    });

    bootstrap.register({
      id: "workspaces.bootstrap",
      order: 200,
      contribute: createWorkspaceBootstrapContributor({
        tenancyProfile: workspaces.tenancyProfile,
        userProfilesRepository: userProfiles,
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

    return {
      workspaces,
      workspaceRecords: records.workspaces,
      workspaceMemberships: records.memberships
    };
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

// Applications' tests build the runtime directly, from this package's public
// feature path, on handles of the four table resources, with the optional tokens' defaults.
export {
  WorkspacesFeature,
  buildWorkspaceName,
  createWorkspaceRecords,
  createWorkspacesRuntime,
  noInviteAcceptanceParticipant,
  noWorkspaceCreatedParticipant,
  renderDefaultWorkspaceInviteEmail,
  unconfiguredWorkspaceInviteMailer
};
