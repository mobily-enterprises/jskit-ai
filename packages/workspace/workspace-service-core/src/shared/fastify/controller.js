import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import {
  buildPublishRequestMeta,
  publishSafely,
  resolvePublishMethod
} from "@jskit-ai/server-runtime-core/realtimePublish";

const WORKSPACE_ACTION_IDS = Object.freeze({
  AUTH_SESSION_READ: "auth.session.read",
  BOOTSTRAP_READ: "workspace.bootstrap.read",
  WORKSPACES_LIST: "workspace.workspaces.list",
  SELECT: "workspace.select",
  INVITATIONS_PENDING_LIST: "workspace.invitations.pending.list",
  INVITE_REDEEM: "workspace.invite.redeem",
  ROLES_LIST: "workspace.roles.list",
  SETTINGS_READ: "workspace.settings.read",
  SETTINGS_UPDATE: "workspace.settings.update",
  MEMBERS_LIST: "workspace.members.list",
  MEMBER_ROLE_UPDATE: "workspace.member.role.update",
  INVITES_LIST: "workspace.invites.list",
  INVITE_CREATE: "workspace.invite.create",
  INVITE_REVOKE: "workspace.invite.revoke",
  AI_TRANSCRIPTS_LIST: "workspace.ai.transcripts.list",
  AI_TRANSCRIPT_MESSAGES_GET: "workspace.ai.transcript.messages.get",
  AI_TRANSCRIPT_EXPORT: "workspace.ai.transcript.export"
});

const DEFAULT_REALTIME_TOPICS = Object.freeze({
  WORKSPACE_META: "workspace_meta",
  WORKSPACE_SETTINGS: "workspace_settings",
  WORKSPACE_MEMBERS: "workspace_members",
  WORKSPACE_INVITES: "workspace_invites"
});

const DEFAULT_REALTIME_EVENT_TYPES = Object.freeze({
  WORKSPACE_META_UPDATED: "workspace.meta.updated",
  WORKSPACE_SETTINGS_UPDATED: "workspace.settings.updated",
  WORKSPACE_MEMBERS_UPDATED: "workspace.members.updated",
  WORKSPACE_INVITES_UPDATED: "workspace.invites.updated"
});

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDecision(value) {
  return normalizeText(value).toLowerCase();
}

async function executeAction(actionExecutor, { actionId, request, input = {}, context = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      request,
      channel: "api",
      ...(context && typeof context === "object" ? context : {})
    }
  });
}

function createController({
  authService,
  consoleService,
  aiTranscriptsService = null,
  realtimeEventsService = null,
  realtimeTopics = DEFAULT_REALTIME_TOPICS,
  realtimeEventTypes = DEFAULT_REALTIME_EVENT_TYPES,
  actionExecutor
}) {
  if (!authService || !consoleService) {
    throw new Error("authService and consoleService are required.");
  }
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }

  const publishWorkspaceEvent = resolvePublishMethod(realtimeEventsService, "publishWorkspaceEvent");
  const REALTIME_TOPICS = realtimeTopics;
  const REALTIME_EVENT_TYPES = realtimeEventTypes;

  function getOAuthProviderCatalogPayload() {
    const catalog =
      typeof authService.getOAuthProviderCatalog === "function" ? authService.getOAuthProviderCatalog() : null;
    const providers = Array.isArray(catalog?.providers)
      ? catalog.providers
          .map((provider) => ({
            id: String(provider?.id || "")
              .trim()
              .toLowerCase(),
            label: String(provider?.label || "").trim()
          }))
          .filter((provider) => provider.id && provider.label)
      : [];
    const defaultProvider = String(catalog?.defaultProvider || "")
      .trim()
      .toLowerCase();

    return {
      oauthProviders: providers,
      oauthDefaultProvider: providers.some((provider) => provider.id === defaultProvider) ? defaultProvider : null
    };
  }

  function publishWorkspaceEventForRequest({ request, topic, eventType, entityType, entityId, payload }) {
    publishSafely({
      publishMethod: publishWorkspaceEvent,
      payload: {
        eventType,
        topic,
        workspace: request?.workspace,
        entityType,
        entityId,
        payload,
        ...buildPublishRequestMeta(request)
      },
      request,
      logCode: "workspace.realtime.publish_failed"
    });
  }

  async function bootstrap(request, reply) {
    const oauthCatalogPayload = getOAuthProviderCatalogPayload();
    const authResult = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.AUTH_SESSION_READ,
      request
    });
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

    const payload = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.BOOTSTRAP_READ,
      request,
      input: {
        user: authResult.authenticated ? authResult.profile : null
      },
      context: {
        actor: authResult.authenticated ? authResult.profile : null
      }
    });

    const session =
      payload?.session && typeof payload.session === "object" ? payload.session : { authenticated: false };

    reply.code(200).send({
      ...payload,
      session: {
        ...session,
        ...oauthCatalogPayload
      }
    });
  }

  async function listWorkspaces(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.WORKSPACES_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async function selectWorkspace(request, reply) {
    const payload = request.body || {};
    const context = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.SELECT,
      request,
      input: payload
    });
    reply.code(200).send({
      ok: true,
      ...context
    });
  }

  async function getWorkspaceSettings(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.SETTINGS_READ,
      request
    });
    reply.code(200).send(response);
  }

  async function updateWorkspaceSettings(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.SETTINGS_UPDATE,
      request,
      input: request.body || {}
    });

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

  async function listWorkspaceRoles(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.ROLES_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async function listWorkspaceMembers(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.MEMBERS_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async function updateWorkspaceMemberRole(request, reply) {
    const memberUserId = request.params?.memberUserId;
    const roleId = request.body?.roleId;
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.MEMBER_ROLE_UPDATE,
      request,
      input: {
        memberUserId,
        roleId
      }
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
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITES_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async function createWorkspaceInvite(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITE_CREATE,
      request,
      input: payload
    });

    publishWorkspaceEventForRequest({
      request,
      topic: REALTIME_TOPICS.WORKSPACE_INVITES,
      eventType: REALTIME_EVENT_TYPES.WORKSPACE_INVITES_UPDATED,
      entityType: "workspace_invite",
      entityId:
        parsePositiveInteger(response?.createdInvite?.inviteId) ||
        parsePositiveInteger(response?.invites?.[0]?.id) ||
        "none",
      payload: {
        operation: "invite_created",
        workspaceId: parsePositiveInteger(request.workspace?.id)
      }
    });

    reply.code(200).send(response);
  }

  async function revokeWorkspaceInvite(request, reply) {
    const inviteId = request.params?.inviteId;
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITE_REVOKE,
      request,
      input: {
        inviteId
      }
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
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITATIONS_PENDING_LIST,
      request
    });
    reply.code(200).send(response);
  }

  async function respondToPendingInviteByToken(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.INVITE_REDEEM,
      request,
      input: payload
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

    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.AI_TRANSCRIPTS_LIST,
      request,
      input: query
    });

    reply.code(200).send(response);
  }

  async function getWorkspaceAiTranscriptMessages(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};
    const conversationId = request.params?.conversationId;

    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.AI_TRANSCRIPT_MESSAGES_GET,
      request,
      input: {
        ...query,
        conversationId
      }
    });

    reply.code(200).send(response);
  }

  async function exportWorkspaceAiTranscript(request, reply) {
    ensureAiTranscriptsService();
    const query = request.query || {};
    const conversationId = request.params?.conversationId;

    const response = await executeAction(actionExecutor, {
      actionId: WORKSPACE_ACTION_IDS.AI_TRANSCRIPT_EXPORT,
      request,
      input: {
        ...query,
        conversationId
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
    respondToPendingInviteByToken,
    listWorkspaceAiTranscripts,
    getWorkspaceAiTranscriptMessages,
    exportWorkspaceAiTranscript
  };
}

export { createController };
