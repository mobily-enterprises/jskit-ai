import { hasPermission } from "../../lib/rbacManifest.js";
import { parsePositiveInteger } from "../../lib/primitives/integers.js";
import { withAuditEvent } from "../../lib/securityAudit.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDecision(value) {
  return normalizeText(value).toLowerCase();
}

function createController({ authService, workspaceService, workspaceAdminService, consoleService, auditService }) {
  if (!authService || !workspaceService || !workspaceAdminService || !consoleService || !auditService) {
    throw new Error("authService, workspaceService, workspaceAdminService, consoleService, and auditService are required.");
  }
  if (typeof auditService.recordSafe !== "function") {
    throw new Error("auditService.recordSafe is required.");
  }

  async function bootstrap(request, reply) {
    const authResult = await authService.authenticateRequest(request);
    if (authResult.clearSession) {
      authService.clearSessionCookies(reply);
    }
    if (authResult.session) {
      authService.writeSessionCookies(reply, authResult.session);
    }

    if (authResult.transientFailure) {
      reply.code(503).send({
        error: "Authentication service temporarily unavailable. Please retry."
      });
      return;
    }

    if (authResult.authenticated && authResult.profile?.id != null) {
      await consoleService.ensureInitialConsoleMember(authResult.profile.id);
    }

    const payload = await workspaceService.buildBootstrapPayload({
      request,
      user: authResult.authenticated ? authResult.profile : null
    });

    reply.code(200).send(payload);
  }

  async function listWorkspaces(request, reply) {
    const workspaces = await workspaceService.listWorkspacesForUser(request.user, {
      request
    });
    reply.code(200).send({
      workspaces
    });
  }

  async function selectWorkspace(request, reply) {
    const payload = request.body || {};
    const workspaceSlug = payload.workspaceSlug || payload.slug || payload.workspaceId;
    const context = await workspaceService.selectWorkspaceForUser(request.user, workspaceSlug, {
      request
    });
    reply.code(200).send({
      ok: true,
      ...context
    });
  }

  async function getWorkspaceSettings(request, reply) {
    const response = await workspaceAdminService.getWorkspaceSettings(request.workspace, {
      includeAppSurfaceDenyLists: hasPermission(request.permissions, "workspace.settings.update")
    });
    reply.code(200).send(response);
  }

  async function updateWorkspaceSettings(request, reply) {
    const response = await workspaceAdminService.updateWorkspaceSettings(request.workspace, request.body || {});
    reply.code(200).send(response);
  }

  async function listWorkspaceRoles(_request, reply) {
    const roleCatalog = workspaceAdminService.getRoleCatalog();
    reply.code(200).send({
      roleCatalog
    });
  }

  async function listWorkspaceMembers(request, reply) {
    const response = await workspaceAdminService.listMembers(request.workspace);
    reply.code(200).send(response);
  }

  async function updateWorkspaceMemberRole(request, reply) {
    const memberUserId = request.params?.memberUserId;
    const roleId = request.body?.roleId;
    const response = await withAuditEvent({
      auditService,
      request,
      action: "workspace.member.role.updated",
      execute: () =>
        workspaceAdminService.updateMemberRole(request.workspace, {
          memberUserId,
          roleId
        }),
      shared: () => ({
        workspaceId: parsePositiveInteger(request.workspace?.id),
        targetUserId: parsePositiveInteger(memberUserId)
      }),
      metadata: () => ({
        roleId: normalizeText(roleId)
      })
    });

    reply.code(200).send(response);
  }

  async function listWorkspaceInvites(request, reply) {
    const response = await workspaceAdminService.listInvites(request.workspace);
    reply.code(200).send(response);
  }

  async function createWorkspaceInvite(request, reply) {
    const payload = request.body || {};
    const response = await withAuditEvent({
      auditService,
      request,
      action: "workspace.invite.created",
      execute: () => workspaceAdminService.createInvite(request.workspace, request.user, payload),
      shared: () => ({
        workspaceId: parsePositiveInteger(request.workspace?.id),
      }),
      metadata: () => ({
        email: normalizeText(payload.email).toLowerCase(),
        roleId: normalizeText(payload.roleId)
      }),
      onSuccess: (context) => ({
        metadata: {
          inviteId: parsePositiveInteger(context?.result?.createdInvite?.inviteId)
        }
      })
    });

    reply.code(200).send(response);
  }

  async function revokeWorkspaceInvite(request, reply) {
    const inviteId = request.params?.inviteId;
    const response = await withAuditEvent({
      auditService,
      request,
      action: "workspace.invite.revoked",
      execute: () => workspaceAdminService.revokeInvite(request.workspace, inviteId),
      shared: () => ({
        workspaceId: parsePositiveInteger(request.workspace?.id),
      }),
      metadata: () => ({
        inviteId: parsePositiveInteger(inviteId)
      }),
    });

    reply.code(200).send(response);
  }

  async function listPendingInvites(request, reply) {
    const pendingInvites = await workspaceService.listPendingInvitesForUser(request.user);
    reply.code(200).send({
      pendingInvites
    });
  }

  async function respondToPendingInviteByToken(request, reply) {
    const payload = request.body || {};
    const response = await withAuditEvent({
      auditService,
      request,
      action: "workspace.invite.redeemed",
      execute: () =>
        workspaceAdminService.respondToPendingInviteByToken({
          user: request.user,
          inviteToken: payload.token,
          decision: payload.decision
        }),
      shared: (context) => ({
        workspaceId: parsePositiveInteger(context?.result?.workspace?.id) || parsePositiveInteger(request.workspace?.id),
        targetUserId: parsePositiveInteger(request.user?.id)
      }),
      metadata: () => ({
        decision: normalizeDecision(payload.decision)
      }),
      onSuccess: (context) => ({
        metadata: {
          inviteId: parsePositiveInteger(context?.result?.inviteId)
        }
      })
    });

    reply.code(200).send(response);
  }

  return {
    bootstrap,
    listWorkspaces,
    selectWorkspace,
    getWorkspaceSettings,
    updateWorkspaceSettings,
    listWorkspaceRoles,
    listWorkspaceMembers,
    updateWorkspaceMemberRole,
    listWorkspaceInvites,
    createWorkspaceInvite,
    revokeWorkspaceInvite,
    listPendingInvites,
    respondToPendingInviteByToken
  };
}

export { createController };
