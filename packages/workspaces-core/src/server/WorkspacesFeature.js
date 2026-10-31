import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createWorkspaceBootstrapContributor } from "./workspaceBootstrapContributor.js";
import { registerWorkspaceDirectoryRoutes } from "./workspaceDirectory/bootWorkspaceDirectoryRoutes.js";
import { createWorkspaceDirectoryActions } from "./workspaceDirectory/workspaceDirectoryActions.js";
import { registerWorkspaceMembersRoutes } from "./workspaceMembers/bootWorkspaceMembers.js";
import { createWorkspaceMembersActions } from "./workspaceMembers/workspaceMembersActions.js";
import { registerWorkspacePendingInvitationsRoutes } from "./workspacePendingInvitations/bootWorkspacePendingInvitations.js";
import { createWorkspacePendingInvitationsActions } from "./workspacePendingInvitations/workspacePendingInvitationsActions.js";
import { registerWorkspaceSettingsRoutes } from "./workspaceSettings/bootWorkspaceSettings.js";
import { unconfiguredWorkspaceInviteMailer } from "./workspaceMembers/unconfiguredWorkspaceInviteMailer.js";
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
    inviteMailer: "workspaces.invite-mailer"
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
   * @param {import("./types.js").WorkspaceInviteMailer | null} capabilities.inviteMailer
   * @param {import("@jskit-ai/json-rest-api-core/server/types").RuntimeJsonRestApi} capabilities.jsonRestApi
   * @param {import("@jskit-ai/users-core/server/types").UsersCore} capabilities.users
   */
  async setup({ appRoot, bootstrap, config, env, http, inviteMailer, jsonRestApi, users }) {
    await installWorkspaceResources(jsonRestApi);
    const workspaces = createWorkspacesRuntime({
      appRoot,
      config,
      env,
      inviteMailer: inviteMailer || unconfiguredWorkspaceInviteMailer,
      jsonRestApi,
      users
    });

    bootstrap.register({
      id: "workspaces.bootstrap",
      order: 200,
      contribute: createWorkspaceBootstrapContributor({
        appConfig: config,
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
    if (!workspaces.enabled) return [];
    return [
      ...createWorkspaceDirectoryActions({ workspaceService: workspaces.services.directory }),
      ...createWorkspaceSettingsActions({ workspaceSettingsService: workspaces.services.settings }),
      ...createWorkspaceMembersActions({ workspaceMembersService: workspaces.services.members }),
      ...(workspaces.invitationsEnabled
        ? createWorkspacePendingInvitationsActions({
            workspacePendingInvitationsService: workspaces.services.pendingInvitations
          })
        : [])
    ];
  }
});

// Applications' tests build the runtime and install its resources directly, from
// this package's public feature path, with the default invite mailer.
export { WorkspacesFeature, createWorkspacesRuntime, installWorkspaceResources, unconfiguredWorkspaceInviteMailer };
