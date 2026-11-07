import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createWorkspaceActionContextContributor } from "./common/contributors/workspaceActionContextContributor.js";
import { createWorkspaceAuthPolicyContextResolver } from "./common/contributors/workspaceAuthPolicyContextResolver.js";
import { createWorkspaceRouteVisibilityResolver } from "./common/contributors/workspaceRouteVisibilityResolver.js";
import {
  resolveWorkspaceMembershipOptionalSurfaceIdsFromAppConfig,
  resolveWorkspaceSurfaceIdsFromAppConfig
} from "./support/workspaceActionSurfaces.js";

/**
 * Every active membership puts the actor in the workspace audience and in its
 * own workspace-user audience. All the actors' memberships are one bulk read.
 * @param {import("./types.js").WorkspacesMemberships} workspaceMemberships
 * @param {string[]} actorIds
 */
async function resolveWorkspaceRealtimeScopes(workspaceMemberships, actorIds) {
  const workspaceIdsByActorId = await workspaceMemberships.listActiveWorkspaceIdsByUserIds(actorIds);
  const scopesByActorId = new Map();
  for (const [actorId, workspaceIds] of workspaceIdsByActorId) {
    scopesByActorId.set(actorId, workspaceIds.flatMap((workspaceId) => [
      { kind: "workspace", id: workspaceId },
      { kind: "workspace_user", workspaceId, userId: actorId }
    ]));
  }
  return scopesByActorId;
}

const WorkspacesIntegrationsProvider = defineProvider({
  id: "workspaces.integrations",
  requires: {
    actions: "runtime.actions",
    authExtensions: "auth.extensions",
    config: "runtime.config",
    http: "runtime.http",
    usersExtensions: "users.extensions",
    workspaceMemberships: "workspaces.memberships",
    workspaces: "workspaces.core"
  },
  optional: {
    realtime: "runtime.realtime"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").ActionCatalogue} capabilities.actions
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} capabilities.authExtensions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} capabilities.config
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/realtime/server/types").RuntimeRealtime | null} capabilities.realtime The installed realtime runtime, when there is one.
   * @param {import("@jskit-ai/users-core/server/types").UsersExtensions} capabilities.usersExtensions
   * @param {import("./types.js").WorkspacesMemberships} capabilities.workspaceMemberships
   * @param {import("./types.js").WorkspacesCore} capabilities.workspaces
   */
  setup({ actions, authExtensions, config, http, realtime, usersExtensions, workspaceMemberships, workspaces }) {
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
      async afterIdentityProfileSynced({ profile, options }) {
        await workspaceService.ensureProvisionedWorkspaceForAuthenticatedUser(profile, options);
      }
    });

    if (realtime) {
      realtime.registerAudienceContributor({
        id: "workspaces.memberships",
        resolveActorsScopes: (actorIds) => resolveWorkspaceRealtimeScopes(workspaceMemberships, actorIds)
      });
    }

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
