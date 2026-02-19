import { parsePositiveInteger } from "../../lib/primitives/integers.js";
import { withAuditEvent } from "../../lib/securityAudit.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDecision(value) {
  return normalizeText(value).toLowerCase();
}

function createController({ consoleService, auditService }) {
  if (!consoleService || !auditService || typeof auditService.recordSafe !== "function") {
    throw new Error("consoleService and auditService.recordSafe are required.");
  }

  async function bootstrap(request, reply) {
    const payload = await consoleService.buildBootstrapPayload({
      user: request.user || null
    });
    reply.code(200).send(payload);
  }

  async function listRoles(request, reply) {
    const response = await consoleService.listRoles(request.user);
    reply.code(200).send(response);
  }

  async function listMembers(request, reply) {
    const response = await consoleService.listMembers(request.user);
    reply.code(200).send(response);
  }

  async function updateMemberRole(request, reply) {
    const memberUserId = request.params?.memberUserId;
    const roleId = request.body?.roleId;
    const response = await withAuditEvent({
      auditService,
      request,
      action: "console.member.role.updated",
      execute: () =>
        consoleService.updateMemberRole(request.user, {
          memberUserId,
          roleId
        }),
      shared: () => ({
        targetUserId: parsePositiveInteger(memberUserId),
      }),
      metadata: () => ({
        roleId: normalizeText(roleId)
      })
    });

    reply.code(200).send(response);
  }

  async function listInvites(request, reply) {
    const response = await consoleService.listInvites(request.user);
    reply.code(200).send(response);
  }

  async function createInvite(request, reply) {
    const payload = request.body || {};
    const response = await withAuditEvent({
      auditService,
      request,
      action: "console.invite.created",
      execute: () => consoleService.createInvite(request.user, payload),
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

  async function revokeInvite(request, reply) {
    const inviteId = request.params?.inviteId;
    const response = await withAuditEvent({
      auditService,
      request,
      action: "console.invite.revoked",
      execute: () => consoleService.revokeInvite(request.user, inviteId),
      metadata: () => ({
        inviteId: parsePositiveInteger(inviteId)
      })
    });

    reply.code(200).send(response);
  }

  async function listPendingInvites(request, reply) {
    const pendingInvites = await consoleService.listPendingInvitesForUser(request.user);
    reply.code(200).send({
      pendingInvites
    });
  }

  async function respondToPendingInviteByToken(request, reply) {
    const payload = request.body || {};
    const response = await withAuditEvent({
      auditService,
      request,
      action: "console.invite.redeemed",
      execute: () =>
        consoleService.respondToPendingInviteByToken({
          user: request.user,
          inviteToken: payload.token,
          decision: payload.decision
        }),
      shared: () => ({
        targetUserId: parsePositiveInteger(request.user?.id),
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
    listRoles,
    listMembers,
    updateMemberRole,
    listInvites,
    createInvite,
    revokeInvite,
    listPendingInvites,
    respondToPendingInviteByToken
  };
}

export { createController };
