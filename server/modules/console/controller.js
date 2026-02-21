import { parsePositiveInteger } from "../../lib/primitives/integers.js";
import { withAuditEvent } from "../../lib/securityAudit.js";
import { AppError } from "../../lib/errors.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDecision(value) {
  return normalizeText(value).toLowerCase();
}

function createController({ consoleService, aiTranscriptsService = null, auditService }) {
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

  async function getAssistantSettings(request, reply) {
    const response = await consoleService.getAssistantSettings(request.user);
    reply.code(200).send(response);
  }

  async function updateAssistantSettings(request, reply) {
    const payload = request.body || {};
    const response = await withAuditEvent({
      auditService,
      request,
      action: "console.assistant.settings.updated",
      execute: () => consoleService.updateAssistantSettings(request.user, payload),
      metadata: () => ({
        assistantSystemPromptWorkspaceLength: String(payload.assistantSystemPromptWorkspace || "").trim().length
      })
    });

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

  function ensureAiTranscriptsService() {
    if (!aiTranscriptsService) {
      throw new AppError(501, "AI transcripts service is not available.");
    }
  }

  async function listAiTranscripts(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};

    const response = await withAuditEvent({
      auditService,
      request,
      action: "ai.transcripts.list.viewed",
      execute: () => aiTranscriptsService.listConsoleConversations(request.user, query),
      metadata: () => ({
        scope: "console",
        workspaceId: parsePositiveInteger(query.workspaceId),
        page: parsePositiveInteger(query.page) || 1,
        pageSize: parsePositiveInteger(query.pageSize) || 20,
        from: normalizeText(query.from),
        to: normalizeText(query.to),
        status: normalizeText(query.status).toLowerCase()
      }),
      onSuccess: (context) => ({
        metadata: {
          returnedCount: Array.isArray(context?.result?.entries) ? context.result.entries.length : 0,
          total: Number(context?.result?.total || 0)
        }
      })
    });

    reply.code(200).send(response);
  }

  async function getAiTranscriptMessages(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};
    const conversationId = request.params?.conversationId;

    const response = await withAuditEvent({
      auditService,
      request,
      action: "ai.transcripts.messages.viewed",
      execute: () => aiTranscriptsService.getConsoleConversationMessages(request.user, conversationId, query),
      metadata: () => ({
        scope: "console",
        conversationId: parsePositiveInteger(conversationId),
        page: parsePositiveInteger(query.page) || 1,
        pageSize: parsePositiveInteger(query.pageSize) || 100
      }),
      onSuccess: (context) => ({
        metadata: {
          returnedCount: Array.isArray(context?.result?.entries) ? context.result.entries.length : 0,
          total: Number(context?.result?.total || 0)
        }
      })
    });

    reply.code(200).send(response);
  }

  async function exportAiTranscripts(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};

    const response = await withAuditEvent({
      auditService,
      request,
      action: "ai.transcripts.exported",
      execute: () => aiTranscriptsService.exportConsoleMessages(request.user, query),
      metadata: () => ({
        scope: "console",
        workspaceId: parsePositiveInteger(query.workspaceId),
        conversationId: parsePositiveInteger(query.conversationId),
        format: normalizeText(query.format).toLowerCase() || "json",
        limit: parsePositiveInteger(query.limit) || null,
        from: normalizeText(query.from),
        to: normalizeText(query.to)
      }),
      onSuccess: (context) => ({
        metadata: {
          exportedCount: Array.isArray(context?.result?.entries) ? context.result.entries.length : 0
        }
      })
    });

    reply.code(200).send(response);
  }

  async function listBillingEvents(request, reply) {
    const query = request.query || {};
    const response = await withAuditEvent({
      auditService,
      request,
      action: "billing.events.console.viewed",
      execute: () => consoleService.listBillingEvents(request.user, query),
      metadata: () => ({
        scope: "console",
        workspaceId: parsePositiveInteger(query.workspaceId),
        userId: parsePositiveInteger(query.userId),
        billableEntityId: parsePositiveInteger(query.billableEntityId),
        operationKey: normalizeText(query.operationKey),
        providerEventId: normalizeText(query.providerEventId),
        source: normalizeText(query.source).toLowerCase(),
        page: parsePositiveInteger(query.page) || 1,
        pageSize: parsePositiveInteger(query.pageSize) || 25
      }),
      onSuccess: (context) => ({
        metadata: {
          returnedCount: Array.isArray(context?.result?.entries) ? context.result.entries.length : 0
        }
      })
    });

    reply.code(200).send(response);
  }

  return {
    bootstrap,
    listRoles,
    getAssistantSettings,
    updateAssistantSettings,
    listMembers,
    updateMemberRole,
    listInvites,
    createInvite,
    revokeInvite,
    listPendingInvites,
    respondToPendingInviteByToken,
    listAiTranscripts,
    getAiTranscriptMessages,
    exportAiTranscripts,
    listBillingEvents
  };
}

export { createController };
