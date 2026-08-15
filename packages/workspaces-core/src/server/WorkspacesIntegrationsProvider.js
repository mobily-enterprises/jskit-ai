import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createWorkspaceActionContextContributor } from "./common/contributors/workspaceActionContextContributor.js";
import { createWorkspaceAuthPolicyContextResolver } from "./common/contributors/workspaceAuthPolicyContextResolver.js";
import { createWorkspaceRouteVisibilityResolver } from "./common/contributors/workspaceRouteVisibilityResolver.js";
import {
  resolveWorkspaceMembershipOptionalSurfaceIdsFromAppConfig,
  resolveWorkspaceSurfaceIdsFromAppConfig
} from "./support/workspaceActionSurfaces.js";

const WorkspacesIntegrationsProvider = defineProvider({
  id: "workspaces.integrations",
  requires: {
    actions: "runtime.actions",
    authExtensions: "auth.extensions",
    config: "runtime.config",
    http: "runtime.http",
    usersExtensions: "users.extensions",
    workspaces: "workspaces.core"
  },
  setup({ actions, authExtensions, config, http, usersExtensions, workspaces }) {
    const workspaceService = workspaces.services.directory;
    const membershipOptionalSurfaceIds = resolveWorkspaceMembershipOptionalSurfaceIdsFromAppConfig(config);
    const workspaceSurfaceIds = resolveWorkspaceSurfaceIdsFromAppConfig(config);

    const actionContext = createWorkspaceActionContextContributor({
      workspaceMembershipOptionalSurfaceIds: membershipOptionalSurfaceIds,
      workspaceService,
      workspaceSurfaceIds
    });
    actions.registerContextContributor({
      id: actionContext.contributorId,
      contribute: actionContext.contribute
    });

    const authPolicyResolver = createWorkspaceAuthPolicyContextResolver({
      workspaceMembershipOptionalSurfaceIds: membershipOptionalSurfaceIds,
      workspaceService
    });
    authExtensions.registerPolicyContextResolver({
      resolverId: "workspaces.policy",
      resolveAuthPolicyContext: authPolicyResolver
    });

    const visibility = createWorkspaceRouteVisibilityResolver({
      workspaceMembershipOptionalSurfaceIds: membershipOptionalSurfaceIds,
      workspaceService
    });
    http.registerVisibilityResolver({
      id: visibility.resolverId,
      resolve: visibility.resolve
    });

    usersExtensions.registerProfileSyncLifecycleContributor({
      contributorId: "workspaces.provisioning",
      order: 100,
      async afterIdentityProfileSynced({ profile, options } = {}) {
        await workspaceService.ensureProvisionedWorkspaceForAuthenticatedUser(profile, options);
      }
    });

    if (workspaces.invitationsEnabled) {
      authExtensions.registerInvitationContextResolver({
        resolverId: "workspaces.invitation",
        resolveInvitationContext(invitation, options = {}) {
          return workspaces.services.pendingInvitations.resolveInviteContextForAuth(invitation, options);
        }
      });
    }

    return {};
  }
});

export { WorkspacesIntegrationsProvider };
