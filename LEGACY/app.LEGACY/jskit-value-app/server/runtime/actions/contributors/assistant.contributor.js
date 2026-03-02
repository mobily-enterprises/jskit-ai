import {
  normalizeObject,
  requireAuthenticated,
  requireServiceMethod,
  resolveRequest,
  resolveUser,
  resolveWorkspace,
  hasPermission,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/action-runtime-core/actionContributorHelpers";
import { normalizeLowerText, normalizeText } from "@jskit-ai/action-runtime-core/server";

function resolveSurfaceId(context, input) {
  const payload = normalizeObject(input);
  const requestSurface = normalizeLowerText(resolveRequest(context)?.headers?.["x-surface-id"] || resolveRequest(context)?.surface);
  const contextSurface = normalizeLowerText(context?.surface);
  const explicitSurface = normalizeLowerText(payload.surfaceId);
  const resolved = explicitSurface || contextSurface || requestSurface || "app";
  if (resolved === "app" || resolved === "admin" || resolved === "console") {
    return resolved;
  }

  return "app";
}

function toLowerSet(values) {
  if (!Array.isArray(values)) {
    return new Set();
  }

  const normalized = values.map((entry) => normalizeLowerText(entry)).filter(Boolean);
  return new Set(normalized);
}

function resolveAssistantRequiredPermission(appConfig) {
  return normalizeText(appConfig?.features?.assistantRequiredPermission);
}

function isAssistantActionAllowedByConfig(actionId, actionsConfig = {}) {
  if (actionsConfig.enabled === false) {
    return false;
  }

  const normalizedActionId = normalizeLowerText(actionId);
  const blockedIds = toLowerSet(actionsConfig.blockedActionIds);
  if (blockedIds.has(normalizedActionId)) {
    return false;
  }

  const exposedIds = toLowerSet(actionsConfig.exposedActionIds);
  if (exposedIds.size > 0 && !exposedIds.has(normalizedActionId)) {
    return false;
  }

  return true;
}

function createAssistantRoutePermissionPolicy({ actionId, actionsConfig, appConfig }) {
  const requiredPermission = resolveAssistantRequiredPermission(appConfig);

  return (context) => {
    if (!requireAuthenticated(context)) {
      return false;
    }

    if (!isAssistantActionAllowedByConfig(actionId, actionsConfig)) {
      return false;
    }

    if (!requiredPermission) {
      return true;
    }

    return hasPermission(context?.permissions, requiredPermission);
  };
}

function canReadWorkspaceAdminTranscripts(context) {
  return normalizeLowerText(context?.surface) === "admin" && hasPermission(context?.permissions, "workspace.ai.transcripts.read");
}

function createAssistantActionContributor({
  aiService,
  aiTranscriptsService = null,
  actionsConfig = {},
  appConfig = {}
} = {}) {
  const contributorId = "app.assistant";

  requireServiceMethod(aiService, "streamChatTurn", contributorId);
  requireServiceMethod(aiService, "validateChatTurnInput", contributorId);
  requireServiceMethod(aiService, "isEnabled", contributorId);

  const actions = [
    {
      id: "assistant.chat.stream",
      version: 1,
      kind: "stream",
      channels: ["api", "assistant_chat", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: createAssistantRoutePermissionPolicy({
        actionId: "assistant.chat.stream",
        actionsConfig,
        appConfig
      }),
      idempotency: "none",
      audit: {
        actionName: "assistant.chat.stream"
      },
      observability: {},
      async execute(input, context, deps = {}) {
        if (typeof aiService.isEnabled === "function" && aiService.isEnabled() !== true) {
          const error = new Error("Not found.");
          error.status = 404;
          error.statusCode = 404;
          error.code = "ASSISTANT_DISABLED";
          throw error;
        }

        const payload = normalizeObject(input);
        const body =
          payload.body && typeof payload.body === "object" && !Array.isArray(payload.body) ? payload.body : payload;
        const request = resolveRequest(context);
        const streamWriter = deps.streamWriter || payload.streamWriter || null;
        const abortSignal = deps.abortSignal || payload.abortSignal;

        if (!streamWriter || typeof streamWriter.sendMeta !== "function") {
          throw new Error("assistant.chat.stream requires deps.streamWriter.");
        }

        const validatedInput = aiService.validateChatTurnInput({
          request,
          body
        });

        await aiService.streamChatTurn({
          request,
          body,
          streamWriter,
          abortSignal,
          validatedInput
        });

        return {
          ok: true
        };
      }
    },
    {
      id: "assistant.conversations.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: createAssistantRoutePermissionPolicy({
        actionId: "assistant.conversations.list",
        actionsConfig,
        appConfig
      }),
      idempotency: "none",
      audit: {
        actionName: "assistant.conversations.list"
      },
      observability: {},
      async execute(input, context) {
        if (!aiTranscriptsService) {
          throw new Error("aiTranscriptsService is required for assistant conversation actions.");
        }

        const payload = normalizeObject(input);
        const workspace = resolveWorkspace(context, payload);
        const user = resolveUser(context, payload);
        const surfaceId = resolveSurfaceId(context, payload);
        const transcriptQuery = {
          ...payload,
          surfaceId
        };
        if (canReadWorkspaceAdminTranscripts(context)) {
          return aiTranscriptsService.listWorkspaceConversations(workspace, transcriptQuery);
        }

        return aiTranscriptsService.listWorkspaceConversationsForUser(workspace, user, transcriptQuery);
      }
    },
    {
      id: "assistant.conversation.messages.list",
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: createAssistantRoutePermissionPolicy({
        actionId: "assistant.conversation.messages.list",
        actionsConfig,
        appConfig
      }),
      idempotency: "none",
      audit: {
        actionName: "assistant.conversation.messages.list"
      },
      observability: {},
      async execute(input, context) {
        if (!aiTranscriptsService) {
          throw new Error("aiTranscriptsService is required for assistant conversation actions.");
        }

        const payload = normalizeObject(input);
        const workspace = resolveWorkspace(context, payload);
        const user = resolveUser(context, payload);
        const conversationId = payload.conversationId || payload.params?.conversationId;
        const surfaceId = resolveSurfaceId(context, payload);
        const transcriptQuery = {
          ...payload,
          surfaceId
        };

        if (canReadWorkspaceAdminTranscripts(context)) {
          return aiTranscriptsService.getWorkspaceConversationMessages(workspace, conversationId, transcriptQuery);
        }

        return aiTranscriptsService.getWorkspaceConversationMessagesForUser(
          workspace,
          user,
          conversationId,
          transcriptQuery
        );
      }
    },
    {
      id: "assistant.conversation.start_new",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: createAssistantRoutePermissionPolicy({
        actionId: "assistant.conversation.start_new",
        actionsConfig,
        appConfig
      }),
      idempotency: "none",
      audit: {
        actionName: "assistant.conversation.start_new"
      },
      observability: {},
      async execute() {
        return {
          ok: true,
          conversationId: null
        };
      }
    },
    {
      id: "assistant.stream.cancel",
      version: 1,
      kind: "command",
      channels: ["api", "internal"],
      surfaces: ["app", "admin"],
      visibility: "public",
      inputSchema: OBJECT_INPUT_SCHEMA,
      permission: createAssistantRoutePermissionPolicy({
        actionId: "assistant.stream.cancel",
        actionsConfig,
        appConfig
      }),
      idempotency: "none",
      audit: {
        actionName: "assistant.stream.cancel"
      },
      observability: {},
      async execute() {
        return {
          ok: true,
          canceled: true
        };
      }
    }
  ];

  return {
    contributorId,
    domain: "assistant",
    actions: Object.freeze(actions)
  };
}

export { createAssistantActionContributor };
