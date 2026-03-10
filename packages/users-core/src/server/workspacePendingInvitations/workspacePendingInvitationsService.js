import {
  encodeInviteTokenHash,
  resolveInviteTokenHash
} from "@jskit-ai/auth-core/server/inviteTokens";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { TENANCY_MODE_WORKSPACE, normalizeTenancyMode } from "@jskit-ai/kernel/shared/surface";
import {
  mapMembershipSummary,
  mapWorkspaceSettingsPublic,
  mapWorkspaceSummary,
  normalizeLowerText,
  normalizeText,
  normalizeUserProfile
} from "../workspace/workspaceMappings.js";

function createService({
  appConfig = {},
  workspaceInvitesRepository,
  workspaceMembershipsRepository,
  workspacesRepository,
  workspaceService
} = {}) {
  if (!workspaceInvitesRepository || !workspaceMembershipsRepository || !workspacesRepository || !workspaceService) {
    throw new Error(
      "workspacePendingInvitationsService requires invite/membership/workspace repositories and workspaceService."
    );
  }

  if (typeof workspaceService.resolveWorkspaceContextForUserBySlug !== "function") {
    throw new Error("workspacePendingInvitationsService requires workspaceService.resolveWorkspaceContextForUserBySlug().");
  }

  const resolvedTenancyMode = normalizeTenancyMode(appConfig.tenancyMode);

  async function listPendingInvitesForUser(user, options = {}) {
    if (resolvedTenancyMode !== TENANCY_MODE_WORKSPACE) {
      return [];
    }

    const normalizedUser = normalizeUserProfile(user);
    if (!normalizedUser || !normalizedUser.email) {
      return [];
    }

    const invites = await workspaceInvitesRepository.listPendingByEmail(normalizedUser.email, options);
    return invites.map((invite) => ({
      id: invite.id,
      workspaceId: invite.workspaceId,
      workspaceSlug: invite.workspaceSlug || "",
      workspaceName: invite.workspaceName || invite.workspaceSlug || "Workspace",
      workspaceAvatarUrl: invite.workspaceAvatarUrl || "",
      roleId: invite.roleId,
      status: invite.status,
      expiresAt: invite.expiresAt,
      token: encodeInviteTokenHash(invite.tokenHash)
    }));
  }

  async function redeemInviteByToken({ user, token, decision } = {}, options = {}) {
    if (resolvedTenancyMode !== TENANCY_MODE_WORKSPACE) {
      throw new AppError(403, "Workspace invites are disabled.");
    }

    const normalizedUser = normalizeUserProfile(user);
    if (!normalizedUser) {
      throw new AppError(401, "Authentication required.");
    }

    const normalizedDecision = normalizeLowerText(decision);
    if (normalizedDecision !== "accept" && normalizedDecision !== "refuse") {
      throw new AppError(400, "decision must be accept or refuse.");
    }

    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
      throw new AppError(400, "Invite token is required.");
    }

    const tokenHash = resolveInviteTokenHash(normalizedToken);
    if (!tokenHash) {
      throw new AppError(400, "Invite token is invalid.");
    }

    const invite = await workspaceInvitesRepository.findPendingByTokenHash(tokenHash, options);
    if (!invite) {
      throw new AppError(404, "Invitation not found or already handled.");
    }

    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      await workspaceInvitesRepository.revokeById(invite.id, options);
      throw new AppError(409, "Invitation has expired.");
    }

    if (normalizeLowerText(invite.email) !== normalizedUser.email) {
      throw new AppError(403, "Invitation email does not match authenticated user.");
    }

    if (normalizedDecision === "accept") {
      await workspaceMembershipsRepository.upsertMembership(
        invite.workspaceId,
        normalizedUser.id,
        {
          roleId: invite.roleId,
          status: "active"
        },
        options
      );
      await workspaceInvitesRepository.markAcceptedById(invite.id, options);

      const workspace = await workspacesRepository.findById(invite.workspaceId, options);
      if (!workspace) {
        throw new AppError(404, "Workspace not found.");
      }

      const acceptedWorkspace = await workspaceService.resolveWorkspaceContextForUserBySlug(
        normalizedUser,
        workspace.slug,
        options
      );

      return {
        decision: "accepted",
        workspace: mapWorkspaceSummary(acceptedWorkspace.workspace, acceptedWorkspace.membership),
        membership: mapMembershipSummary(acceptedWorkspace.membership, acceptedWorkspace.workspace),
        permissions: acceptedWorkspace.permissions,
        workspaceSettings: mapWorkspaceSettingsPublic(acceptedWorkspace.workspaceSettings)
      };
    }

    await workspaceInvitesRepository.revokeById(invite.id, options);
    return {
      decision: "refused"
    };
  }

  return Object.freeze({
    listPendingInvitesForUser,
    redeemInviteByToken
  });
}

export { createService };
