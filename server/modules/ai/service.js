import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.js";
import { parsePositiveInteger } from "../../lib/primitives/integers.js";
import { safePathnameFromRequest } from "../../lib/primitives/requestUrl.js";
import { publishWorkspaceEventSafely, resolvePublishWorkspaceEvent } from "../../lib/realtimeEvents.js";
import { buildAuditEventBase } from "../../lib/securityAudit.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../../../shared/realtime/eventTypes.js";
import { resolveSurfaceFromPathname } from "../../../shared/routing/surfacePaths.js";
import { normalizeSurfaceId } from "../../../shared/routing/surfaceRegistry.js";
import { buildAiToolRegistry, executeToolCall, listToolSchemas } from "./tools/registry.js";
import {
  resolveAssistantSystemPromptAppFromWorkspaceSettings,
  resolveAssistantSystemPromptWorkspaceFromConsoleSettings
} from "../../lib/aiAssistantSystemPrompt.js";

const DEFAULT_ASSISTANT_TOOL_SURFACE_ALLOWLIST = Object.freeze({
  app: Object.freeze([]),
  admin: Object.freeze(["workspace_rename"])
});

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeRole(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "user" || normalized === "assistant") {
    return normalized;
  }

  return "";
}

function normalizeMessageId(value) {
  const messageId = normalizeText(value);
  if (!messageId) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          messageId: "messageId is required."
        }
      }
    });
  }

  if (messageId.length > 128) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          messageId: "messageId must be at most 128 characters."
        }
      }
    });
  }

  return messageId;
}

function normalizeConversationId(value) {
  if (value == null) {
    return null;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (!/^[0-9]+$/.test(normalized)) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          conversationId: "conversationId must be a positive integer."
        }
      }
    });
  }

  const conversationId = parsePositiveInteger(normalized);
  if (!conversationId) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          conversationId: "conversationId must be a positive integer."
        }
      }
    });
  }

  return conversationId;
}

function normalizeInput(value, maxInputChars) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          input: "Input is required."
        }
      }
    });
  }

  if (normalized.length > maxInputChars) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          input: `Input must be at most ${maxInputChars} characters.`
        }
      }
    });
  }

  return normalized;
}

function normalizeHistory(history, { maxHistoryMessages, maxInputChars }) {
  const input = Array.isArray(history) ? history : [];
  const normalizedHistory = [];

  for (const message of input) {
    const role = normalizeRole(message?.role);
    if (!role) {
      continue;
    }

    const content = normalizeText(message?.content);
    if (!content) {
      continue;
    }

    normalizedHistory.push({
      role,
      content: content.length > maxInputChars ? content.slice(0, maxInputChars) : content
    });
  }

  if (normalizedHistory.length <= maxHistoryMessages) {
    return normalizedHistory;
  }

  return normalizedHistory.slice(normalizedHistory.length - maxHistoryMessages);
}

function normalizeClientContext(value) {
  const input = value && typeof value === "object" ? value : {};
  const locale = normalizeText(input.locale).slice(0, 64);
  const timezone = normalizeText(input.timezone).slice(0, 64);

  return {
    locale,
    timezone
  };
}

function normalizeSurfaceToolAllowlist(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = {
    app: [],
    admin: []
  };

  for (const [rawSurfaceId, rawToolNames] of Object.entries(source)) {
    const surfaceId = normalizeSurfaceId(rawSurfaceId);
    const list = Array.isArray(rawToolNames) ? rawToolNames : [];
    const toolNames = Array.from(
      new Set(
        list
          .map((toolName) => normalizeText(toolName))
          .filter(Boolean)
      )
    );

    if (!normalized[surfaceId]) {
      normalized[surfaceId] = [];
    }
    normalized[surfaceId] = toolNames;
  }

  return normalized;
}

function resolveAssistantSurfaceId(request) {
  const explicitSurface = normalizeText(request?.surface);
  if (explicitSurface) {
    return normalizeSurfaceId(explicitSurface);
  }

  const headerSurface = normalizeText(request?.headers?.["x-surface-id"]);
  if (headerSurface) {
    return normalizeSurfaceId(headerSurface);
  }

  return normalizeSurfaceId(resolveSurfaceFromPathname(safePathnameFromRequest(request)));
}

function buildSurfaceCapabilityPrompt(surfaceId, toolNames = []) {
  const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
  const availableTools = Array.isArray(toolNames) ? toolNames.map((name) => normalizeText(name)).filter(Boolean) : [];
  const toolSegment = availableTools.length > 0 ? availableTools.join(", ") : "none";

  if (normalizedSurfaceId === "admin") {
    return [
      "Surface scope: admin.",
      "Use only tools explicitly provided for this admin surface.",
      `Admin-surface tools available in this turn: ${toolSegment}.`
    ].join(" ");
  }

  return [
    "Surface scope: app.",
    "Do not perform workspace admin operations (settings, members, invites, transcript export).",
    `App-surface tools available in this turn: ${toolSegment}.`
  ].join(" ");
}

function buildSystemPrompt({
  workspace,
  user,
  clientContext,
  assistantSurfaceId = "app",
  allowedToolNames = [],
  workspaceCustomPrompt = ""
}) {
  const workspaceId = parsePositiveInteger(workspace?.id) || "unknown";
  const workspaceSlug = normalizeText(workspace?.slug) || "unknown";
  const workspaceName = normalizeText(workspace?.name) || "unknown";
  const actorUserId = parsePositiveInteger(user?.id) || "unknown";
  const actorEmail = normalizeText(user?.email) || "unknown";
  const locale = normalizeText(clientContext?.locale) || "unknown";
  const timezone = normalizeText(clientContext?.timezone) || "unknown";

  return [
    "You are the workspace assistant for the active workspace.",
    "Only claim actions are complete when a tool result confirms success.",
    "When permission is denied or validation fails, explain plainly and suggest a valid next step.",
    "Never invent tool execution results.",
    buildSurfaceCapabilityPrompt(assistantSurfaceId, allowedToolNames),
    workspaceCustomPrompt ? `Workspace-specific assistant instructions: ${workspaceCustomPrompt}` : "",
    `Workspace context: id=${workspaceId}, slug=${workspaceSlug}, name=${workspaceName}.`,
    `Actor context: userId=${actorUserId}, email=${actorEmail}.`,
    `Client context: locale=${locale}, timezone=${timezone}.`
  ]
    .filter(Boolean)
    .join("\n");
}

function extractDeltaText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  let text = "";
  for (const entry of content) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    if (typeof entry.text === "string") {
      text += entry.text;
    }
  }

  return text;
}

function normalizeToolCallId(value, index) {
  const normalized = normalizeText(value);
  if (normalized) {
    return normalized;
  }

  return `call_${index}_${randomUUID()}`;
}

function parseToolArguments(argumentsText) {
  const normalized = String(argumentsText || "").trim();
  if (!normalized) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new AppError(400, "Validation failed.", {
      code: "AI_TOOL_ARGUMENTS_INVALID",
      details: {
        fieldErrors: {
          toolArguments: "Tool arguments must be valid JSON."
        }
      }
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(400, "Validation failed.", {
      code: "AI_TOOL_ARGUMENTS_INVALID",
      details: {
        fieldErrors: {
          toolArguments: "Tool arguments must be a JSON object."
        }
      }
    });
  }

  return parsed;
}

function buildAssistantToolCallMessage({ assistantText, toolCalls }) {
  return {
    role: "assistant",
    content: assistantText || "",
    tool_calls: toolCalls.map((toolCall, index) => ({
      id: normalizeToolCallId(toolCall.id, index),
      type: "function",
      function: {
        name: normalizeText(toolCall.name),
        arguments: String(toolCall.argumentsText || "")
      }
    }))
  };
}

function isAbortError(error) {
  const name = normalizeText(error?.name);
  const code = normalizeText(error?.code).toUpperCase();

  if (name === "AbortError") {
    return true;
  }

  return code === "ABORT_ERR";
}

function isTimeoutError(error) {
  const name = normalizeText(error?.name).toLowerCase();
  const message = normalizeText(error?.message).toLowerCase();

  return name.includes("timeout") || message.includes("timeout") || message.includes("timed out");
}

function mapErrorEventToTurnOutcome(mappedError) {
  const code = normalizeText(mappedError?.code).toLowerCase();
  if (code === "stream_aborted") {
    return "aborted";
  }
  if (code === "forbidden") {
    return "forbidden";
  }
  if (code === "validation_failed") {
    return "validation";
  }
  if (code === "provider_timeout") {
    return "timeout";
  }

  return "failure";
}

function mapToolErrorToOutcome(mappedToolError) {
  const code = normalizeText(mappedToolError?.code).toLowerCase();
  if (code === "tool_forbidden") {
    return "forbidden";
  }
  if (code === "tool_invalid_arguments") {
    return "invalid_args";
  }
  if (code === "tool_unknown") {
    return "unknown";
  }

  return "failure";
}

function mapErrorToEvent(error, { stage = "chat" } = {}) {
  if (isAbortError(error)) {
    return {
      code: "stream_aborted",
      message: "Request canceled.",
      status: 499,
      stage
    };
  }

  if (error instanceof AppError) {
    const appCode = normalizeText(error.code).toUpperCase();

    if (appCode === "AI_TOOL_ARGUMENTS_INVALID") {
      return {
        code: "tool_invalid_arguments",
        message: "Tool arguments were invalid.",
        status: error.status,
        stage
      };
    }

    if (appCode === "AI_TOOL_UNKNOWN") {
      return {
        code: "tool_unknown",
        message: "Unknown tool.",
        status: error.status,
        stage
      };
    }

    if (appCode === "AI_TOOL_FORBIDDEN" || error.status === 403) {
      if (appCode === "AI_TOOL_FORBIDDEN") {
        return {
          code: "tool_forbidden",
          message: "Tool execution is forbidden.",
          status: error.status,
          stage
        };
      }

      return {
        code: "forbidden",
        message: "Forbidden.",
        status: error.status,
        stage
      };
    }

    if (appCode === "AI_TOOL_LIMIT_REACHED") {
      return {
        code: "tool_limit_reached",
        message: "AI tool-call limit reached.",
        status: error.status,
        stage
      };
    }

    if (appCode === "AI_EMPTY_OUTPUT") {
      return {
        code: "provider_empty_output",
        message: "AI provider returned no output.",
        status: error.status,
        stage
      };
    }

    if (error.status === 400) {
      return {
        code: "validation_failed",
        message: "Validation failed.",
        status: error.status,
        stage
      };
    }

    if (error.status === 404) {
      return {
        code: "not_found",
        message: "Not found.",
        status: error.status,
        stage
      };
    }

    return {
      code: "request_failed",
      message: normalizeText(error.message) || "Request failed.",
      status: error.status,
      stage
    };
  }

  if (isTimeoutError(error)) {
    return {
      code: "provider_timeout",
      message: "AI provider timed out.",
      status: 504,
      stage
    };
  }

  return {
    code: "provider_error",
    message: "AI provider request failed.",
    status: 502,
    stage
  };
}

async function consumeCompletionStream({ stream, streamWriter }) {
  let assistantText = "";
  const toolCallsByIndex = new Map();

  for await (const chunk of stream) {
    const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];

    for (const choice of choices) {
      const delta = choice?.delta && typeof choice.delta === "object" ? choice.delta : {};
      const textDelta = extractDeltaText(delta.content);
      if (textDelta) {
        assistantText += textDelta;
        streamWriter.sendAssistantDelta(textDelta);
      }

      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const rawToolCall of toolCalls) {
        const index = Number.isInteger(rawToolCall?.index) ? rawToolCall.index : 0;
        const existing = toolCallsByIndex.get(index) || {
          index,
          id: "",
          name: "",
          argumentsText: ""
        };

        if (rawToolCall?.id) {
          existing.id = String(rawToolCall.id);
        }

        if (rawToolCall?.function?.name) {
          existing.name += String(rawToolCall.function.name);
        }

        if (typeof rawToolCall?.function?.arguments === "string") {
          existing.argumentsText += rawToolCall.function.arguments;
        }

        toolCallsByIndex.set(index, existing);
      }
    }
  }

  const toolCalls = [...toolCallsByIndex.values()]
    .sort((left, right) => left.index - right.index)
    .map((toolCall, index) => ({
      id: normalizeToolCallId(toolCall.id, index),
      name: normalizeText(toolCall.name),
      argumentsText: String(toolCall.argumentsText || "")
    }));

  return {
    assistantText,
    toolCalls
  };
}

function createService({
  providerClient,
  workspaceAdminService,
  workspaceSettingsRepository = null,
  consoleSettingsRepository = null,
  realtimeEventsService,
  aiTranscriptsService = null,
  auditService,
  observabilityService = null,
  aiModel = "gpt-4.1-mini",
  aiMaxInputChars = 8000,
  aiMaxHistoryMessages = 20,
  aiMaxToolCallsPerTurn = 4,
  assistantToolSurfaceAllowlist = DEFAULT_ASSISTANT_TOOL_SURFACE_ALLOWLIST
} = {}) {
  if (!providerClient || typeof providerClient.createChatCompletionStream !== "function") {
    throw new Error("providerClient.createChatCompletionStream is required.");
  }
  if (!workspaceAdminService) {
    throw new Error("workspaceAdminService is required.");
  }
  if (
    workspaceSettingsRepository &&
    typeof workspaceSettingsRepository.ensureForWorkspaceId !== "function"
  ) {
    throw new Error("workspaceSettingsRepository.ensureForWorkspaceId must be a function when provided.");
  }
  if (consoleSettingsRepository && typeof consoleSettingsRepository.ensure !== "function") {
    throw new Error("consoleSettingsRepository.ensure must be a function when provided.");
  }
  if (!auditService || typeof auditService.recordSafe !== "function") {
    throw new Error("auditService.recordSafe is required.");
  }
  if (aiTranscriptsService && typeof aiTranscriptsService.startConversationForTurn !== "function") {
    throw new Error("aiTranscriptsService.startConversationForTurn must be a function when provided.");
  }
  if (aiTranscriptsService && typeof aiTranscriptsService.appendMessage !== "function") {
    throw new Error("aiTranscriptsService.appendMessage must be a function when provided.");
  }
  if (aiTranscriptsService && typeof aiTranscriptsService.completeConversation !== "function") {
    throw new Error("aiTranscriptsService.completeConversation must be a function when provided.");
  }

  const maxInputChars = toPositiveInteger(aiMaxInputChars, 8000);
  const maxHistoryMessages = toPositiveInteger(aiMaxHistoryMessages, 20);
  const maxToolCallsPerTurn = toPositiveInteger(aiMaxToolCallsPerTurn, 4);
  const providerModel = normalizeText(aiModel) || "gpt-4.1-mini";
  const allToolsRegistry = buildAiToolRegistry({
    workspaceAdminService,
    realtimeEventsService
  });
  const knownToolNames = new Set(Object.keys(allToolsRegistry));
  const surfaceToolAllowlist = normalizeSurfaceToolAllowlist(assistantToolSurfaceAllowlist);
  const publishWorkspaceEvent = resolvePublishWorkspaceEvent(realtimeEventsService);

  function resolveToolsForSurface(surfaceId) {
    const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
    const allowedToolNames = Array.isArray(surfaceToolAllowlist[normalizedSurfaceId])
      ? surfaceToolAllowlist[normalizedSurfaceId]
      : [];

    const scopedRegistry = {};
    for (const toolName of allowedToolNames) {
      if (!allToolsRegistry[toolName]) {
        continue;
      }

      scopedRegistry[toolName] = allToolsRegistry[toolName];
    }

    return {
      toolRegistry: scopedRegistry,
      providerTools: listToolSchemas(scopedRegistry),
      allowedToolNames: Object.keys(scopedRegistry)
    };
  }

  function validateChatTurnInput({ body } = {}) {
    const payload = body && typeof body === "object" ? body : {};

    return {
      messageId: normalizeMessageId(payload.messageId),
      conversationId: normalizeConversationId(payload.conversationId),
      input: normalizeInput(payload.input, maxInputChars),
      history: normalizeHistory(payload.history, {
        maxHistoryMessages,
        maxInputChars
      }),
      clientContext: normalizeClientContext(payload.clientContext)
    };
  }

  async function streamChatTurn({ request, body, streamWriter, abortSignal, validatedInput } = {}) {
    if (!request || !streamWriter) {
      throw new Error("request and streamWriter are required.");
    }

    if (providerClient.enabled === false) {
      throw new AppError(404, "Not found.");
    }

    const workspaceId = parsePositiveInteger(request.workspace?.id);
    const workspaceSlug = normalizeText(request.workspace?.slug);
    const auditBase = buildAuditEventBase(request);
    const fallbackMessageId = normalizeText(validatedInput?.messageId || body?.messageId).slice(0, 128) || "unknown";
    const turnStartedAt = process.hrtime.bigint();
    let turnMetricRecorded = false;
    let transcriptConversation = null;
    let transcriptConversationId = null;
    let transcriptMode = "";

    let messageId = fallbackMessageId;

    function recordTurnMetric(outcome) {
      if (turnMetricRecorded) {
        return;
      }
      turnMetricRecorded = true;

      if (!observabilityService || typeof observabilityService.recordAiTurn !== "function") {
        return;
      }

      const durationMs = Number(process.hrtime.bigint() - turnStartedAt) / 1_000_000;
      observabilityService.recordAiTurn({
        surface: auditBase.surface,
        provider: String(providerClient.provider || "openai"),
        outcome,
        durationMs
      });
    }

    function recordToolCallMetric({ tool, outcome }) {
      if (!observabilityService || typeof observabilityService.recordAiToolCall !== "function") {
        return;
      }

      observabilityService.recordAiToolCall({
        tool: knownToolNames.has(tool) ? tool : "unknown",
        outcome
      });
    }

    async function recordAudit(action, outcome, metadata = {}) {
      await auditService.recordSafe(
        {
          ...auditBase,
          action,
          outcome,
          workspaceId,
          metadata: {
            messageId,
            conversationId: transcriptConversationId,
            transcriptMode,
            workspaceId,
            workspaceSlug,
            model: providerModel,
            provider: String(providerClient.provider || "openai"),
            ...metadata
          }
        },
        request.log
      );
    }

    function publishTranscriptEventSafely({ operation, message = null } = {}) {
      if (!publishWorkspaceEvent) {
        return;
      }

      if (!transcriptConversationId) {
        return;
      }

      const normalizedOperation = normalizeText(operation).toLowerCase() || "updated";
      const messageIdValue = parsePositiveInteger(message?.id);
      const messageKindValue = normalizeText(message?.kind).toLowerCase();

      publishWorkspaceEventSafely({
        publishWorkspaceEvent,
        request,
        workspace: request?.workspace,
        topic: REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS,
        eventType: REALTIME_EVENT_TYPES.WORKSPACE_AI_TRANSCRIPTS_UPDATED,
        entityType: "ai_transcript_conversation",
        entityId: transcriptConversationId,
        payload: {
          operation: normalizedOperation,
          conversationId: transcriptConversationId,
          workspaceId: parsePositiveInteger(request.workspace?.id),
          workspaceSlug: normalizeText(request.workspace?.slug),
          status: normalizeText(transcriptConversation?.status).toLowerCase(),
          transcriptMode: normalizeText(transcriptMode).toLowerCase(),
          ...(messageIdValue ? { messageId: messageIdValue } : {}),
          ...(messageKindValue ? { messageKind: messageKindValue } : {})
        },
        logCode: "ai.transcript.realtime_publish_failed",
        logContext: {
          messageId,
          conversationId: transcriptConversationId,
          operation: normalizedOperation
        }
      });
    }

    async function appendTranscriptMessage(payload = {}) {
      if (!transcriptConversation || !aiTranscriptsService) {
        return null;
      }

      try {
        const persistedMessage = await aiTranscriptsService.appendMessage({
          conversation: transcriptConversation,
          ...payload
        });

        if (persistedMessage) {
          publishTranscriptEventSafely({
            operation: "message_appended",
            message: persistedMessage
          });
        }

        return persistedMessage;
      } catch (error) {
        if (request?.log && typeof request.log.warn === "function") {
          request.log.warn(
            {
              err: error,
              messageId,
              conversationId: transcriptConversationId,
              kind: normalizeText(payload?.kind)
            },
            "ai.transcript.append_failed"
          );
        }

        return null;
      }
    }

    async function finalizeTranscriptConversation(status, metadata = {}) {
      if (!transcriptConversation || !aiTranscriptsService) {
        return null;
      }

      try {
        const updatedConversation = await aiTranscriptsService.completeConversation(transcriptConversation, {
          status,
          metadata
        });
        if (updatedConversation) {
          transcriptConversation = updatedConversation;
          transcriptConversationId = parsePositiveInteger(updatedConversation.id) || transcriptConversationId;
          transcriptMode = normalizeText(updatedConversation.transcriptMode) || transcriptMode;
          publishTranscriptEventSafely({
            operation: "conversation_status_updated"
          });
        }

        return updatedConversation;
      } catch (error) {
        if (request?.log && typeof request.log.warn === "function") {
          request.log.warn(
            {
              err: error,
              messageId,
              conversationId: transcriptConversationId,
              status
            },
            "ai.transcript.finalize_failed"
          );
        }

        return null;
      }
    }

    try {
      const preparedInput =
        validatedInput && typeof validatedInput === "object"
          ? validatedInput
          : validateChatTurnInput({
              body
            });
      messageId = preparedInput.messageId;
      const requestedConversationId = preparedInput.conversationId;
      const input = preparedInput.input;
      const history = preparedInput.history;
      const clientContext = preparedInput.clientContext;
      const assistantSurfaceId = resolveAssistantSurfaceId(request);
      const {
        toolRegistry: scopedToolRegistry,
        providerTools: scopedProviderTools,
        allowedToolNames
      } = resolveToolsForSurface(assistantSurfaceId);
      let workspaceCustomPrompt = "";
      if (assistantSurfaceId === "app" && workspaceSettingsRepository && workspaceId) {
        try {
          const workspaceSettings = await workspaceSettingsRepository.ensureForWorkspaceId(workspaceId);
          workspaceCustomPrompt = resolveAssistantSystemPromptAppFromWorkspaceSettings(workspaceSettings);
        } catch (settingsError) {
          if (request?.log && typeof request.log.warn === "function") {
            request.log.warn(
              {
                err: settingsError,
                workspaceId,
                assistantSurfaceId
              },
              "ai.workspace_settings_prompt_lookup_failed"
            );
          }
        }
      }
      if (assistantSurfaceId === "admin" && consoleSettingsRepository) {
        try {
          const consoleSettings = await consoleSettingsRepository.ensure();
          workspaceCustomPrompt = resolveAssistantSystemPromptWorkspaceFromConsoleSettings(consoleSettings);
        } catch (settingsError) {
          if (request?.log && typeof request.log.warn === "function") {
            request.log.warn(
              {
                err: settingsError,
                assistantSurfaceId
              },
              "ai.console_settings_prompt_lookup_failed"
            );
          }
        }
      }

      if (aiTranscriptsService) {
        const transcriptStart = await aiTranscriptsService.startConversationForTurn({
          workspace: request.workspace,
          user: request.user,
          conversationId: requestedConversationId,
          messageId,
          provider: String(providerClient.provider || "openai"),
          model: providerModel
        });

        transcriptConversation = transcriptStart?.conversation || null;
        transcriptConversationId = parsePositiveInteger(transcriptConversation?.id) || null;
        transcriptMode = normalizeText(transcriptStart?.transcriptMode || transcriptConversation?.transcriptMode);

        if (transcriptConversationId) {
          publishTranscriptEventSafely({
            operation: "conversation_started"
          });
        }
      }

      await recordAudit("ai.chat.requested", "success", {
        inputChars: input.length,
        historyCount: history.length,
        conversationId: transcriptConversationId
      });

      streamWriter.sendMeta({
        messageId,
        conversationId: transcriptConversationId ? String(transcriptConversationId) : null,
        model: providerModel,
        provider: String(providerClient.provider || "openai")
      });

      const systemPrompt = buildSystemPrompt({
        workspace: request.workspace,
        user: request.user,
        clientContext,
        assistantSurfaceId,
        allowedToolNames,
        workspaceCustomPrompt
      });

      const conversation = [
        {
          role: "system",
          content: systemPrompt
        },
        ...history,
        {
          role: "user",
          content: input
        }
      ];

      await appendTranscriptMessage({
        role: "user",
        kind: "chat",
        clientMessageId: messageId,
        actorUserId: request.user?.id,
        content: input,
        metadata: {
          historyCount: history.length
        }
      });

      const toolContext = {
        request,
        workspace: request.workspace,
        user: request.user,
        permissions: Array.isArray(request.permissions) ? request.permissions : []
      };

      let totalToolCalls = 0;
      let emptyOutputRetryCount = 0;
      let disableToolsForNextCompletion = false;

      while (true) {
        if (abortSignal?.aborted) {
          const aborted = new Error("Request canceled.");
          aborted.name = "AbortError";
          throw aborted;
        }

        const providerStream = await providerClient.createChatCompletionStream({
          model: providerModel,
          messages: conversation,
          tools: disableToolsForNextCompletion ? [] : scopedProviderTools,
          signal: abortSignal,
          temperature: 0.2
        });

        const completion = await consumeCompletionStream({
          stream: providerStream,
          streamWriter
        });

        if (completion.toolCalls.length < 1) {
          const assistantMessage = String(completion.assistantText || "");
          if (!normalizeText(assistantMessage)) {
            if (emptyOutputRetryCount < 1) {
              emptyOutputRetryCount += 1;
              disableToolsForNextCompletion = true;
              conversation.push({
                role: "system",
                content:
                  "Your previous response was empty. Reply with a concise, helpful plain-language answer to the latest user message."
              });
              continue;
            }
            throw new AppError(502, "AI provider returned no output.", {
              code: "AI_EMPTY_OUTPUT"
            });
          }

          await appendTranscriptMessage({
            role: "assistant",
            kind: "chat",
            content: assistantMessage,
            metadata: {
              source: "provider"
            }
          });
          streamWriter.sendAssistantMessage(assistantMessage);
          streamWriter.sendDone({
            messageId
          });

          await finalizeTranscriptConversation("completed", {
            toolCalls: totalToolCalls
          });

          await recordAudit("ai.chat.completed", "success", {
            toolCalls: totalToolCalls
          });
          recordTurnMetric("success");
          return;
        }

        disableToolsForNextCompletion = false;
        const assistantToolCallMessage = buildAssistantToolCallMessage({
          assistantText: completion.assistantText,
          toolCalls: completion.toolCalls
        });
        conversation.push(assistantToolCallMessage);

        for (const toolCall of completion.toolCalls) {
          if (totalToolCalls >= maxToolCallsPerTurn) {
            throw new AppError(409, "AI tool-call limit reached.", {
              code: "AI_TOOL_LIMIT_REACHED"
            });
          }

          totalToolCalls += 1;
          const toolName = normalizeText(toolCall.name);
          const toolCallId = normalizeToolCallId(toolCall.id, totalToolCalls);

          streamWriter.sendToolCall({
            toolCallId,
            name: toolName,
            arguments: String(toolCall.argumentsText || "")
          });

          await appendTranscriptMessage({
            role: "assistant",
            kind: "tool_call",
            content: String(toolCall.argumentsText || ""),
            metadata: {
              toolCallId,
              tool: toolName
            }
          });

          let toolMessagePayload;

          try {
            const parsedArgs = parseToolArguments(toolCall.argumentsText);
            const toolResult = await executeToolCall(scopedToolRegistry, {
              name: toolName,
              args: parsedArgs,
              context: toolContext
            });

            toolMessagePayload = {
              ok: true,
              result: toolResult
            };

            streamWriter.sendToolResult({
              toolCallId,
              name: toolName,
              ok: true,
              result: toolResult
            });

            await appendTranscriptMessage({
              role: "tool",
              kind: "tool_result",
              content: JSON.stringify(toolMessagePayload),
              metadata: {
                toolCallId,
                tool: toolName,
                ok: true
              }
            });

            await recordAudit("ai.tool.executed", "success", {
              tool: toolName
            });
            recordToolCallMetric({
              tool: toolName,
              outcome: "success"
            });
          } catch (error) {
            const mappedToolError = mapErrorToEvent(error, {
              stage: "tool"
            });

            toolMessagePayload = {
              ok: false,
              error: {
                code: mappedToolError.code,
                message: mappedToolError.message
              }
            };

            streamWriter.sendToolResult({
              toolCallId,
              name: toolName,
              ok: false,
              error: toolMessagePayload.error
            });

            await appendTranscriptMessage({
              role: "tool",
              kind: "tool_result",
              content: JSON.stringify(toolMessagePayload),
              metadata: {
                toolCallId,
                tool: toolName,
                ok: false,
                code: mappedToolError.code,
                status: mappedToolError.status
              }
            });

            await recordAudit("ai.tool.failed", "failure", {
              tool: toolName,
              code: mappedToolError.code,
              status: mappedToolError.status
            });
            recordToolCallMetric({
              tool: toolName,
              outcome: mapToolErrorToOutcome(mappedToolError)
            });
          }

          conversation.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: JSON.stringify(toolMessagePayload)
          });
        }
      }
    } catch (error) {
      const mappedError = mapErrorToEvent(error);
      await recordAudit("ai.chat.failed", "failure", {
        code: mappedError.code,
        status: mappedError.status
      });
      recordTurnMetric(mapErrorEventToTurnOutcome(mappedError));

      await appendTranscriptMessage({
        role: "assistant",
        kind: "error",
        content: mappedError.message,
        metadata: {
          code: mappedError.code,
          status: mappedError.status,
          stage: mappedError.stage
        }
      });

      await finalizeTranscriptConversation(mappedError.code === "stream_aborted" ? "aborted" : "failed", {
        code: mappedError.code,
        status: mappedError.status
      });

      streamWriter.sendError({
        messageId,
        code: mappedError.code,
        message: mappedError.message,
        status: mappedError.status
      });

      error.__aiStreamErrorEmitted = true;
      throw error;
    }
  }

  function isEnabled() {
    return providerClient.enabled === true;
  }

  return {
    isEnabled,
    validateChatTurnInput,
    streamChatTurn
  };
}

const __testables = {
  normalizeMessageId,
  normalizeConversationId,
  normalizeInput,
  normalizeHistory,
  normalizeClientContext,
  buildSystemPrompt,
  toPositiveInteger,
  extractDeltaText,
  parseToolArguments,
  buildAssistantToolCallMessage,
  isAbortError,
  isTimeoutError,
  mapErrorToEvent,
  mapErrorEventToTurnOutcome,
  mapToolErrorToOutcome,
  consumeCompletionStream
};

export { createService, __testables };
