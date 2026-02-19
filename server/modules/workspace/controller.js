import { hasPermission } from "../../lib/rbacManifest.js";
import { parsePositiveInteger } from "../../lib/primitives/integers.js";
import { withAuditEvent } from "../../lib/securityAudit.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../shared/realtime/eventTypes.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDecision(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function createController({
  authService,
  workspaceService,
  workspaceAdminService,
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

  const publishWorkspaceEvent =
    realtimeEventsService && typeof realtimeEventsService.publishWorkspaceEvent === "function"
      ? realtimeEventsService.publishWorkspaceEvent
      : null;

  function publishWorkspaceEventSafely({ request, topic, eventType, entityType, entityId, payload }) {
    if (!publishWorkspaceEvent) {
      return;
    }

    try {
      publishWorkspaceEvent({
        eventType,
        topic,
        workspace: request.workspace,
        entityType,
        entityId,
        commandId: normalizeHeaderValue(request?.headers?.["x-command-id"]),
        sourceClientId: normalizeHeaderValue(request?.headers?.["x-client-id"]),
        actorUserId: request?.user?.id,
        payload
      });
    } catch (error) {
      const warnLogger = request?.log && typeof request.log.warn === "function" ? request.log.warn.bind(request.log) : null;
      if (warnLogger) {
        warnLogger({ err: error }, "workspace.realtime.publish_failed");
      }
    }
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
    publishWorkspaceEventSafely({
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
    publishWorkspaceEventSafely({
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

    publishWorkspaceEventSafely({
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

    publishWorkspaceEventSafely({
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

    publishWorkspaceEventSafely({
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

    publishWorkspaceEventSafely({
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
