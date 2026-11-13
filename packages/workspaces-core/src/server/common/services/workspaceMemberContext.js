import { normalizeAuthActor } from "@jskit-ai/auth-core/server/authActor";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeVisibilityContext, ROUTE_VISIBILITY_WORKSPACE_USER } from "@jskit-ai/kernel/shared/support/visibility";
import { isSystemContext } from "@jskit-ai/resource-runtime/server";
import { buildVisibilityContribution } from "../contributors/workspaceRouteVisibilityResolver.js";

/**
 * The actor of a signed-in request by the user this profile is, as every auth provider that keeps users' profiles
 * builds it from its own account and the profile.
 * @param {{ id: string, authProvider: string, authProviderUserSid: string, email: string, displayName: string }} profile
 */
function memberActorOf(profile) {
  return normalizeAuthActor({
    provider: profile.authProvider,
    providerUserId: profile.authProviderUserSid,
    email: profile.email,
    displayName: profile.displayName,
    appUserId: profile.id,
    profileSource: "users"
  });
}

/**
 * The `memberContext` of `workspaces.core`.
 * @param {object} dependencies
 * @param {import("../../types.js").WorkspaceDirectoryService} dependencies.workspaceService
 * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} dependencies.userProfiles
 */
function createWorkspaceMemberContexts({ workspaceService, userProfiles }) {
  /**
   * The context of one member of one workspace, for background work done as that member (a record started for the
   * person it is assigned to, a notification for one recipient, a submission synced for the person who made it): the
   * context the member's own request on a `workspace_user` route runs its action in, resolved by the same reads and
   * checks. Its `actor` is the member, as a signed-in request's (`resolveActorId` answers them, an action's permission
   * check reads their `permissions`, a row policy is told `caller.kind` "user"); `workspace`, `membership` and
   * `permissions` are their workspace context's, which `requestMeta.resolvedWorkspaceContext` holds with the
   * settings; its scope is the workspace and the member, so an event it publishes reaches that member there. It is no
   * system context and no job: request row limits apply, and other owners' hidden fields stay hidden, as at the
   * member's request.
   *
   * Only a system context makes one (`{ context: systemContext(reason) }`, with `trx` to read in the caller's
   * transaction): any other context, a forWorkspace job's too, is a TypeError, as are ids that are no record ids. A
   * missing or deleted workspace is 404 `workspaces.workspace.notFound`, and a user who is no active member of it
   * (removed, inactive, never one, or no user at all) 403 `workspaces.workspace.accessDenied`, as for the member's
   * request; the owner's membership is ensured, as at the owner's request. It reads no sign-in state: an account its
   * auth provider refuses at sign-in is still resolved. An action it runs names the surface the member's request
   * would: `actions.execute({ actionId, input, context: { ...member, surface: "app" } })`.
   * @param {{ workspaceId: unknown, userId: unknown }} member
   * @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options
   */
  async function memberContext({ workspaceId, userId } = {}, options = {}) {
    if (!isSystemContext(options.context)) {
      throw new TypeError("workspaces.memberContext() runs only in a system context: pass { context: systemContext(reason) }.");
    }
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    const normalizedUserId = normalizeRecordId(userId, { fallback: null });
    if (!normalizedWorkspaceId || !normalizedUserId) {
      throw new TypeError(
        "workspaces.memberContext() takes { workspaceId, userId }, the ids of a workspace and of its member. " +
          `Received: ${String(workspaceId)}, ${String(userId)}`
      );
    }
    // A user id that names no one is no member, which the membership check refuses.
    const profile = await userProfiles.findById(normalizedUserId, options);
    const resolvedWorkspaceContext = await workspaceService.resolveMemberWorkspaceContextById(profile, normalizedWorkspaceId, options);
    return Object.freeze({
      actor: memberActorOf(profile),
      workspace: resolvedWorkspaceContext.workspace,
      membership: resolvedWorkspaceContext.membership,
      permissions: resolvedWorkspaceContext.permissions,
      // An action it runs resolves its visibility as that route's request does, to this visibility context.
      routeVisibility: ROUTE_VISIBILITY_WORKSPACE_USER,
      visibilityContext: normalizeVisibilityContext({
        visibility: ROUTE_VISIBILITY_WORKSPACE_USER,
        ...buildVisibilityContribution({
          visibility: ROUTE_VISIBILITY_WORKSPACE_USER,
          scopeOwnerId: resolvedWorkspaceContext.workspace.id,
          userId: profile.id
        })
      }),
      requestMeta: Object.freeze({ resolvedWorkspaceContext })
    });
  }

  return Object.freeze({
    memberContext
  });
}

export { createWorkspaceMemberContexts };
