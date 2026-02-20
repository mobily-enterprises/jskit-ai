import { hasPermission } from "../../lib/rbacManifest.js";
import { parsePositiveInteger } from "../../lib/primitives/integers.js";
import { withAuditEvent } from "../../lib/securityAudit.js";
import { AppError } from "../../lib/errors.js";
import { publishWorkspaceEventSafely, resolvePublishWorkspaceEvent } from "../../lib/realtimeEvents.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../shared/realtime/eventTypes.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDecision(value) {
  return normalizeText(value).toLowerCase();
}

function createController({
  authService,
  workspaceService,
  workspaceAdminService,
  aiTranscriptsService = null,
  consoleService,
  auditService,
  realtimeEventsService = null
}) {
  if (!authService || !workspaceService || !workspaceAdminService || !consoleService || !auditService) {
    throw new Error("authService, workspaceService, workspaceAdminService, consoleService, and auditService are required.");
  }
  if (typeof auditService.recordSafe !== "function") {
    throw new Error("auditService.recordSafe is required.");
  }

  const publishWorkspaceEvent = resolvePublishWorkspaceEvent(realtimeEventsService);

  function publishWorkspaceEventForRequest({ request, topic, eventType, entityType, entityId, payload }) {
    publishWorkspaceEventSafely({
      publishWorkspaceEvent,
      request,
      workspace: request?.workspace,
      topic,
      eventType,
      entityType,
      entityId,
      payload,
      logCode: "workspace.realtime.publish_failed"
    });
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
    publishWorkspaceEventForRequest({
      request,
      topic: REALTIME_TOPICS.WORKSPACE_SETTINGS,
      eventType: REALTIME_EVENT_TYPES.WORKSPACE_SETTINGS_UPDATED,
      entityType: "workspace",
      entityId: request.workspace?.id,
      payload: {
        operation: "updated",
        workspaceId: parsePositiveInteger(request.workspace?.id),
        workspaceSlug: normalizeText(request.workspace?.slug)
      }
    });
    publishWorkspaceEventForRequest({
      request,
      topic: REALTIME_TOPICS.WORKSPACE_META,
      eventType: REALTIME_EVENT_TYPES.WORKSPACE_META_UPDATED,
      entityType: "workspace",
      entityId: request.workspace?.id,
      payload: {
        operation: "updated",
        workspaceId: parsePositiveInteger(request.workspace?.id),
        workspaceSlug: normalizeText(request.workspace?.slug)
      }
    });
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

    publishWorkspaceEventForRequest({
      request,
      topic: REALTIME_TOPICS.WORKSPACE_MEMBERS,
      eventType: REALTIME_EVENT_TYPES.WORKSPACE_MEMBERS_UPDATED,
      entityType: "workspace_member",
      entityId: parsePositiveInteger(memberUserId) || normalizeText(memberUserId),
      payload: {
        operation: "member_role_updated",
        workspaceId: parsePositiveInteger(request.workspace?.id),
        memberUserId: parsePositiveInteger(memberUserId),
        roleId: normalizeText(roleId)
      }
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

    publishWorkspaceEventForRequest({
      request,
      topic: REALTIME_TOPICS.WORKSPACE_INVITES,
      eventType: REALTIME_EVENT_TYPES.WORKSPACE_INVITES_UPDATED,
      entityType: "workspace_invite",
      entityId:
        parsePositiveInteger(response?.createdInvite?.inviteId) || parsePositiveInteger(response?.invites?.[0]?.id) || "none",
      payload: {
        operation: "invite_created",
        workspaceId: parsePositiveInteger(request.workspace?.id)
      }
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

    publishWorkspaceEventForRequest({
      request,
      topic: REALTIME_TOPICS.WORKSPACE_INVITES,
      eventType: REALTIME_EVENT_TYPES.WORKSPACE_INVITES_UPDATED,
      entityType: "workspace_invite",
      entityId: parsePositiveInteger(inviteId) || normalizeText(inviteId),
      payload: {
        operation: "invite_revoked",
        workspaceId: parsePositiveInteger(request.workspace?.id),
        inviteId: parsePositiveInteger(inviteId)
      }
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

    publishWorkspaceEventForRequest({
      request,
      topic: REALTIME_TOPICS.WORKSPACE_INVITES,
      eventType: REALTIME_EVENT_TYPES.WORKSPACE_INVITES_UPDATED,
      entityType: "workspace_invite",
      entityId: parsePositiveInteger(response?.inviteId) || "none",
      payload: {
        operation: "invite_redeemed",
        workspaceId: parsePositiveInteger(response?.workspace?.id) || parsePositiveInteger(request.workspace?.id),
        inviteId: parsePositiveInteger(response?.inviteId),
        decision: normalizeDecision(payload.decision)
      }
    });

    reply.code(200).send(response);
  }

  function ensureAiTranscriptsService() {
    if (!aiTranscriptsService) {
      throw new AppError(501, "AI transcripts service is not available.");
    }
  }

  async function listWorkspaceAiTranscripts(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};

    const response = await withAuditEvent({
      auditService,
      request,
      action: "ai.transcripts.list.viewed",
      execute: () => aiTranscriptsService.listWorkspaceConversations(request.workspace, query),
      shared: () => ({
        workspaceId: parsePositiveInteger(request.workspace?.id)
      }),
      metadata: () => ({
        page: parsePositiveInteger(query.page) || 1,
        pageSize: parsePositiveInteger(query.pageSize) || 20,
        from: normalizeText(query.from),
        to: normalizeText(query.to),
        status: normalizeText(query.status).toLowerCase(),
        createdByUserId: parsePositiveInteger(query.createdByUserId) || null
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

  async function getWorkspaceAiTranscriptMessages(request, reply) {
    ensureAiTranscriptsService();
    const params = request.params || {};
    const query = request.query || {};
    const conversationId = params.conversationId;

    const response = await withAuditEvent({
      auditService,
      request,
      action: "ai.transcripts.messages.viewed",
      execute: () => aiTranscriptsService.getWorkspaceConversationMessages(request.workspace, conversationId, query),
      shared: () => ({
        workspaceId: parsePositiveInteger(request.workspace?.id)
      }),
      metadata: () => ({
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

  async function exportWorkspaceAiTranscript(request, reply) {
    ensureAiTranscriptsService();
    const params = request.params || {};
    const query = request.query || {};
    const conversationId = params.conversationId;

    const response = await withAuditEvent({
      auditService,
      request,
      action: "ai.transcripts.exported",
      execute: () => aiTranscriptsService.exportWorkspaceConversation(request.workspace, conversationId, query),
      shared: () => ({
        workspaceId: parsePositiveInteger(request.workspace?.id)
      }),
      metadata: () => ({
        conversationId: parsePositiveInteger(conversationId),
        format: normalizeText(query.format).toLowerCase() || "json",
        limit: parsePositiveInteger(query.limit) || null
      }),
      onSuccess: (context) => ({
        metadata: {
          exportedCount: Array.isArray(context?.result?.entries) ? context.result.entries.length : 0
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
    respondToPendingInviteByToken,
    listWorkspaceAiTranscripts,
    getWorkspaceAiTranscriptMessages,
    exportWorkspaceAiTranscript
  };
}

export { createController };
