import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createWorkspaceActionContextContributor } from "./common/contributors/workspaceActionContextContributor.js";
import { createWorkspaceAuthPolicyContextResolver } from "./common/contributors/workspaceAuthPolicyContextResolver.js";
import { createWorkspaceRouteVisibilityResolver } from "./common/contributors/workspaceRouteVisibilityResolver.js";
import {
  resolveWorkspaceMembershipOptionalSurfaceIdsFromAppConfig,
  resolveWorkspaceSurfaceIdsFromAppConfig
} from "./support/workspaceActionSurfaces.js";

// Every active membership puts the actor in the workspace audience and in its
// own workspace-user audience.
async function resolveWorkspaceRealtimeScopes(workspaceMemberships, actorId) {
  const workspaceIds = await workspaceMemberships.listActiveWorkspaceIdsByUserId(actorId);
  return workspaceIds.flatMap((workspaceId) => [
    { kind: "workspace", id: workspaceId },
    { kind: "workspace_user", workspaceId, userId: actorId }
  ]);
}

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
  optional: {
    realtime: "runtime.realtime"
  },
  setup({ actions, authExtensions, config, http, realtime, usersExtensions, workspaces }) {
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

    realtime?.registerAudienceContributor({
      id: "workspaces.memberships",
      resolveActorScopes: (actorId) => resolveWorkspaceRealtimeScopes(
        workspaces.repositories.workspaceMemberships,
        actorId
      )
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
