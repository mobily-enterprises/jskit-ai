import { randomUUID } from "node:crypto";
import { buildAiToolRegistry, executeToolCall, listToolSchemas } from "./toolRegistry.js";

const DEFAULT_REALTIME_TOPICS = Object.freeze({
  WORKSPACE_AI_TRANSCRIPTS: "workspace_ai_transcripts"
});

const DEFAULT_REALTIME_EVENT_TYPES = Object.freeze({
  WORKSPACE_AI_TRANSCRIPTS_UPDATED: "workspace.ai.transcripts.updated"
});

class DefaultAppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = options.code || "APP_ERROR";
    this.details = options.details;
    this.headers = options.headers || {};
  }
}

let AppError = DefaultAppError;

function parsePositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return null;
  }

  return numeric;
}

const LOCAL_BASE_URL = "http://localhost";

function safeRequestUrl(request) {
  const rawUrl = request?.raw?.url || request?.url || "/";

  try {
    return new URL(rawUrl, LOCAL_BASE_URL);
  } catch {
    return new URL("/", LOCAL_BASE_URL);
  }
}

function defaultSafePathnameFromRequest(request) {
  return safeRequestUrl(request).pathname;
}

function resolveClientIpAddress(request) {
  const forwardedFor = String(request?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const [firstHop] = forwardedFor.split(",");
    const candidate = String(firstHop || "").trim();
    if (candidate) {
      return candidate;
    }
  }

  const requestIp = String(request?.ip || "").trim();
  if (requestIp) {
    return requestIp;
  }

  const socketAddress = String(request?.socket?.remoteAddress || request?.raw?.socket?.remoteAddress || "").trim();
  if (socketAddress) {
    return socketAddress;
  }

  return "unknown";
}

function resolvePublishMethod(realtimeEventsService, methodName) {
  if (!realtimeEventsService || typeof methodName !== "string") {
    return null;
  }

  return typeof realtimeEventsService[methodName] === "function" ? realtimeEventsService[methodName] : null;
}

function normalizeHeaderValue(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function buildPublishRequestMeta(request) {
  return {
    commandId: normalizeHeaderValue(request?.headers?.["x-command-id"]),
    sourceClientId: normalizeHeaderValue(request?.headers?.["x-client-id"]),
    actorUserId: request?.user?.id
  };
}

function publishSafely({ publishMethod, payload, request, logCode, logContext = {} } = {}) {
  if (typeof publishMethod !== "function") {
    return false;
  }

  try {
    publishMethod(payload);
    return true;
  } catch (error) {
    const warnLogger = request?.log && typeof request.log.warn === "function" ? request.log.warn.bind(request.log) : null;
    if (warnLogger) {
      warnLogger(
        {
          err: error,
          ...(logContext && typeof logContext === "object" ? logContext : {})
        },
        String(logCode || "realtime.publish_failed")
      );
    }
    return false;
  }
}

function defaultResolvePublishWorkspaceEvent(realtimeEventsService) {
  return resolvePublishMethod(realtimeEventsService, "publishWorkspaceEvent");
}

function defaultPublishWorkspaceEventSafely({
  publishWorkspaceEvent,
  request,
  workspace = request?.workspace,
  topic,
  eventType,
  entityType = "workspace",
  entityId = workspace?.id,
  payload = {},
  logCode = "workspace.realtime.publish_failed",
  logContext = {}
} = {}) {
  return publishSafely({
    publishMethod: publishWorkspaceEvent,
    payload: {
      eventType,
      topic,
      workspace,
      entityType,
      entityId,
      payload,
      ...buildPublishRequestMeta(request)
    },
    request,
    logCode,
    logContext
  });
}

function defaultNormalizeSurfaceId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "app";
  }
  if (normalized === "app" || normalized === "admin" || normalized === "console") {
    return normalized;
  }
  return "app";
}

function defaultResolveSurfaceFromPathname(pathnameValue) {
  const pathname = String(pathnameValue || "").trim().toLowerCase();
  if (!pathname) {
    return "app";
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return "admin";
  }
  if (pathname === "/console" || pathname.startsWith("/console/")) {
    return "console";
  }
  return "app";
}

function normalizePromptValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length <= 4000 ? normalized : normalized.slice(0, 4000);
}

function resolveFeatures(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  return value;
}

function resolveAiSystemPrompts(features) {
  const normalizedFeatures = resolveFeatures(features);
  const ai = resolveFeatures(normalizedFeatures.ai);
  return resolveFeatures(ai.systemPrompts);
}

function defaultResolveAssistantSystemPromptAppFromWorkspaceSettings(workspaceSettings) {
  const features = resolveFeatures(workspaceSettings?.features);
  const prompts = resolveAiSystemPrompts(features);
  return normalizePromptValue(prompts.app);
}

function defaultResolveAssistantSystemPromptWorkspaceFromConsoleSettings(consoleSettings) {
  const features = resolveFeatures(consoleSettings?.features);
  const prompts = resolveAiSystemPrompts(features);
  return normalizePromptValue(prompts.workspace);
}

function defaultBuildAuditEventBase(request) {
  const pathnameValue = safePathnameFromRequest(request);
  return {
    actorUserId: parsePositiveInteger(request?.user?.id),
    actorEmail: String(request?.user?.email || "")
      .trim()
      .toLowerCase(),
    surface: defaultNormalizeSurfaceId(defaultResolveSurfaceFromPathname(pathnameValue)),
    requestId: String(request?.id || "").trim(),
    method: String(request?.method || "")
      .trim()
      .toUpperCase(),
    path: pathnameValue,
    ipAddress: resolveClientIpAddress(request),
    userAgent: String(request?.headers?.["user-agent"] || "")
  };
}

let safePathnameFromRequest = defaultSafePathnameFromRequest;
let publishWorkspaceEventSafely = defaultPublishWorkspaceEventSafely;
let resolvePublishWorkspaceEvent = defaultResolvePublishWorkspaceEvent;
let buildAuditEventBase = defaultBuildAuditEventBase;
let resolveSurfaceFromPathname = defaultResolveSurfaceFromPathname;
let normalizeSurfaceId = defaultNormalizeSurfaceId;
let resolveAssistantSystemPromptAppFromWorkspaceSettings = defaultResolveAssistantSystemPromptAppFromWorkspaceSettings;
let resolveAssistantSystemPromptWorkspaceFromConsoleSettings =
  defaultResolveAssistantSystemPromptWorkspaceFromConsoleSettings;

const DEFAULT_ASSISTANT_TOOL_SURFACE_ALLOWLIST = Object.freeze({
  app: Object.freeze([]),
  admin: Object.freeze([])
});
const DEFAULT_CONVERSATION_TITLE = "New conversation";
const MAX_CONVERSATION_TITLE_LENGTH = 160;
const MAX_GENERATED_CONVERSATION_TITLE_LENGTH = 80;
const CONVERSATION_TITLE_SETTLE_TIMEOUT_MS = 1200;
const NON_SUBSTANTIVE_TITLE_PATTERN =
  /^(?:hi+|hello+|hey+|yo+|ciao+|hola+|sup+|ok+|okay+|thanks+|thank you|ping|test)(?:\s+(?:there|assistant))?$/;
const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "hi",
  "hello",
  "hey",
  "yo",
  "ciao",
  "hola",
  "sup",
  "ok",
  "okay",
  "thanks",
  "thank",
  "you",
  "there",
  "assistant",
  "good",
  "morning",
  "afternoon",
  "evening",
  "night",
  "please",
  "test",
  "ping"
]);

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
    const toolNames = Array.from(new Set(list.map((toolName) => normalizeText(toolName)).filter(Boolean)));

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

function normalizeConversationTitle(value) {
  const compact = normalizeText(value).replace(/\s+/g, " ");
  const unquoted = compact.replace(/^["'`]+|["'`]+$/g, "");
  const trimmedEnding = unquoted.replace(/[.!?]+$/g, "").trim();
  if (!trimmedEnding) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  const bounded = trimmedEnding.slice(0, MAX_CONVERSATION_TITLE_LENGTH).trim();
  return bounded || DEFAULT_CONVERSATION_TITLE;
}

function normalizeTitleCandidateText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSubstantiveConversationInput(value) {
  const normalized = normalizeTitleCandidateText(value);
  if (!normalized) {
    return false;
  }
  if (NON_SUBSTANTIVE_TITLE_PATTERN.test(normalized)) {
    return false;
  }
  if (normalized.length < 8) {
    return false;
  }

  const words = normalized.split(" ").filter(Boolean);
  const meaningfulWords = words.filter((word) => word.length > 2 && !TITLE_STOPWORDS.has(word));
  if (meaningfulWords.length < 1) {
    return false;
  }

  return meaningfulWords.join("").length >= 5;
}

function extractCompletionMessageText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  let text = "";
  for (const entry of content) {
    if (typeof entry === "string") {
      text += entry;
      continue;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }

    if (typeof entry.text === "string") {
      text += entry.text;
    }
  }

  return text;
}

function buildConversationTitleGenerationPrompt({ assistantSurfaceId, userInput }) {
  const surfaceId = normalizeSurfaceId(assistantSurfaceId);
  const normalizedUserInput = normalizeText(userInput);

  return [
    {
      role: "system",
      content: [
        "You create concise conversation titles for an AI assistant transcript list.",
        "Return only the title text.",
        `Keep it under ${MAX_GENERATED_CONVERSATION_TITLE_LENGTH} characters.`,
        "Do not use quotes, markdown, prefixes, numbering, or trailing punctuation."
      ].join(" ")
    },
    {
      role: "user",
      content: [`Surface: ${surfaceId}.`, `First user message: ${normalizedUserInput}`].join("\n")
    }
  ];
}

function withTimeout(promise, timeoutMs) {
  const timeout = toPositiveInteger(timeoutMs, CONVERSATION_TITLE_SETTLE_TIMEOUT_MS);
  if (!(promise instanceof Promise)) {
    return Promise.resolve(promise);
  }

  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeout);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer != null) {
      clearTimeout(timer);
    }
  });
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
  assistantToolSurfaceAllowlist = DEFAULT_ASSISTANT_TOOL_SURFACE_ALLOWLIST,
  appErrorClass = null,
  tools = [],
  hasPermissionFn = null,
  realtimeEventTypes = null,
  realtimeTopics = null,
  safePathnameFromRequestFn = null,
  resolvePublishWorkspaceEventFn = null,
  publishWorkspaceEventSafelyFn = null,
  buildAuditEventBaseFn = null,
  resolveSurfaceFromPathnameFn = null,
  normalizeSurfaceIdFn = null,
  resolveAssistantSystemPromptAppFromWorkspaceSettingsFn = null,
  resolveAssistantSystemPromptWorkspaceFromConsoleSettingsFn = null
} = {}) {
  if (typeof appErrorClass === "function") {
    AppError = appErrorClass;
  } else {
    AppError = DefaultAppError;
  }
  safePathnameFromRequest =
    typeof safePathnameFromRequestFn === "function" ? safePathnameFromRequestFn : defaultSafePathnameFromRequest;
  resolvePublishWorkspaceEvent =
    typeof resolvePublishWorkspaceEventFn === "function"
      ? resolvePublishWorkspaceEventFn
      : defaultResolvePublishWorkspaceEvent;
  publishWorkspaceEventSafely =
    typeof publishWorkspaceEventSafelyFn === "function"
      ? publishWorkspaceEventSafelyFn
      : defaultPublishWorkspaceEventSafely;
  buildAuditEventBase = typeof buildAuditEventBaseFn === "function" ? buildAuditEventBaseFn : defaultBuildAuditEventBase;
  resolveSurfaceFromPathname =
    typeof resolveSurfaceFromPathnameFn === "function" ? resolveSurfaceFromPathnameFn : defaultResolveSurfaceFromPathname;
  normalizeSurfaceId = typeof normalizeSurfaceIdFn === "function" ? normalizeSurfaceIdFn : defaultNormalizeSurfaceId;
  resolveAssistantSystemPromptAppFromWorkspaceSettings =
    typeof resolveAssistantSystemPromptAppFromWorkspaceSettingsFn === "function"
      ? resolveAssistantSystemPromptAppFromWorkspaceSettingsFn
      : defaultResolveAssistantSystemPromptAppFromWorkspaceSettings;
  resolveAssistantSystemPromptWorkspaceFromConsoleSettings =
    typeof resolveAssistantSystemPromptWorkspaceFromConsoleSettingsFn === "function"
      ? resolveAssistantSystemPromptWorkspaceFromConsoleSettingsFn
      : defaultResolveAssistantSystemPromptWorkspaceFromConsoleSettings;
  const resolvedRealtimeEventTypes =
    realtimeEventTypes && typeof realtimeEventTypes === "object"
      ? {
          ...DEFAULT_REALTIME_EVENT_TYPES,
          ...realtimeEventTypes
        }
      : DEFAULT_REALTIME_EVENT_TYPES;
  const resolvedRealtimeTopics =
    realtimeTopics && typeof realtimeTopics === "object"
      ? {
          ...DEFAULT_REALTIME_TOPICS,
          ...realtimeTopics
        }
      : DEFAULT_REALTIME_TOPICS;

  if (!providerClient || typeof providerClient.createChatCompletionStream !== "function") {
    throw new Error("providerClient.createChatCompletionStream is required.");
  }
  if (workspaceSettingsRepository && typeof workspaceSettingsRepository.ensureForWorkspaceId !== "function") {
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
    tools
  });
  const permissionCheck = typeof hasPermissionFn === "function" ? hasPermissionFn : null;
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

  async function generateConversationTitleFromInput({ userInput, assistantSurfaceId, requestLog }) {
    if (typeof providerClient.createChatCompletion !== "function") {
      return "";
    }

    try {
      const completion = await providerClient.createChatCompletion({
        model: providerModel,
        messages: buildConversationTitleGenerationPrompt({
          assistantSurfaceId,
          userInput
        }),
        temperature: 0
      });
      const completionText = extractCompletionMessageText(completion?.choices?.[0]?.message?.content);
      return normalizeConversationTitle(completionText);
    } catch (error) {
      if (requestLog && typeof requestLog.warn === "function") {
        requestLog.warn(
          {
            err: error,
            assistantSurfaceId
          },
          "ai.conversation_title_generation_failed"
        );
      }

      return "";
    }
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
    let conversationTitlePromise = null;

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
        topic: resolvedRealtimeTopics.WORKSPACE_AI_TRANSCRIPTS,
        eventType: resolvedRealtimeEventTypes.WORKSPACE_AI_TRANSCRIPTS_UPDATED,
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

      const conversationHasDefaultTitle =
        normalizeConversationTitle(transcriptConversation?.title) === DEFAULT_CONVERSATION_TITLE;
      const shouldGenerateConversationTitle =
        isSubstantiveConversationInput(input) &&
        conversationHasDefaultTitle &&
        transcriptConversation &&
        aiTranscriptsService &&
        typeof aiTranscriptsService.updateConversationTitle === "function";

      if (shouldGenerateConversationTitle) {
        conversationTitlePromise = generateConversationTitleFromInput({
          userInput: input,
          assistantSurfaceId,
          requestLog: request?.log
        })
          .then(async (generatedTitle) => {
            const normalizedGeneratedTitle = normalizeConversationTitle(generatedTitle);
            if (!normalizedGeneratedTitle || normalizedGeneratedTitle === DEFAULT_CONVERSATION_TITLE) {
              return null;
            }

            const updatedConversation = await aiTranscriptsService.updateConversationTitle(
              transcriptConversation,
              normalizedGeneratedTitle
            );

            if (updatedConversation) {
              transcriptConversation = updatedConversation;
              transcriptConversationId = parsePositiveInteger(updatedConversation.id) || transcriptConversationId;
              publishTranscriptEventSafely({
                operation: "conversation_title_updated"
              });
            }

            return updatedConversation;
          })
          .catch((error) => {
            if (request?.log && typeof request.log.warn === "function") {
              request.log.warn(
                {
                  err: error,
                  conversationId: transcriptConversationId
                },
                "ai.conversation_title_update_failed"
              );
            }
            return null;
          });
      }

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

          if (conversationTitlePromise) {
            await withTimeout(conversationTitlePromise, CONVERSATION_TITLE_SETTLE_TIMEOUT_MS);
          }

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
              context: toolContext,
              appErrorClass: AppError,
              hasPermissionFn: permissionCheck
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
  DEFAULT_CONVERSATION_TITLE,
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_GENERATED_CONVERSATION_TITLE_LENGTH,
  normalizeMessageId,
  normalizeConversationId,
  normalizeInput,
  normalizeHistory,
  normalizeClientContext,
  normalizeConversationTitle,
  normalizeTitleCandidateText,
  isSubstantiveConversationInput,
  extractCompletionMessageText,
  buildConversationTitleGenerationPrompt,
  withTimeout,
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
