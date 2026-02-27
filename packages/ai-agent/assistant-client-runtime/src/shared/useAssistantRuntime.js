import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  assistantConversationMessagesQueryKey,
  assistantConversationsListQueryKey,
  assistantWorkspaceScopeQueryKey,
  ASSISTANT_STREAM_EVENT_TYPES,
  normalizeAssistantStreamEventType
} from "@jskit-ai/assistant-contracts";

const HISTORY_PAGE = 1;
const RESTORE_MESSAGES_PAGE = 1;
const REDACTED_CONTENT_PLACEHOLDER = "No content stored by policy.";
const DEFAULT_USE_WORKSPACE_STORE = () => ({
  activeWorkspace: null,
  activeWorkspaceSlug: ""
});
const DEFAULT_RESOLVE_SURFACE_FROM_PATHNAME = () => "app";

function buildId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeToolName(value) {
  const normalized = normalizeText(value);
  return normalized || "tool";
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function normalizeDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}

function resolveCurrentSurfaceId(resolveSurfaceFromPathname) {
  if (typeof window !== "undefined" && window?.location?.pathname) {
    return resolveSurfaceFromPathname(String(window.location.pathname));
  }

  return "app";
}

function normalizeConversationStatus(value) {
  const status = normalizeText(value).toLowerCase();
  if (!status) {
    return "unknown";
  }

  return status;
}

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function parseToolResultPayload(value) {
  const source = String(value || "").trim();
  if (!source) {
    return {};
  }

  try {
    const parsed = JSON.parse(source);
    return normalizeObject(parsed);
  } catch {
    return {};
  }
}

function isConversationalMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  const role = message.role;
  if (role !== "user" && role !== "assistant") {
    return false;
  }

  return String(message.kind || "chat") !== "tool_event";
}

function isHistoryEligibleMessage(message) {
  if (!isConversationalMessage(message)) {
    return false;
  }

  if (!normalizeText(message.text)) {
    return false;
  }

  return normalizeText(message.status).toLowerCase() === "done";
}

function buildHistory(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(isHistoryEligibleMessage)
    .map((message) => ({
      role: message.role,
      content: String(message.text || "")
    }))
    .filter((message) => normalizeText(message.content));
}

function buildToolCallSummary(event) {
  const name = normalizeToolName(event?.name);
  return `Tool call: ${name}`;
}

function buildToolResultSummary(event) {
  const name = normalizeToolName(event?.name);
  const failed = event?.ok === false;
  if (failed) {
    const reason = normalizeText(event?.error?.message) || "Tool execution failed.";
    return `Tool result: ${name} failed (${reason})`;
  }

  return `Tool result: ${name} completed`;
}

function mapTranscriptEntriesToAssistantState(entries) {
  const transcriptEntries = Array.isArray(entries) ? entries : [];
  const restoredMessages = [];
  const toolEventsById = new Map();

  function ensureToolEvent(toolCallId, name) {
    const key = normalizeText(toolCallId) || buildId("tool_call");
    const existing = toolEventsById.get(key);
    if (existing) {
      return existing;
    }

    const event = {
      id: key,
      name: normalizeToolName(name),
      arguments: "",
      status: "pending",
      result: null,
      error: null
    };
    toolEventsById.set(key, event);
    return event;
  }

  for (const entry of transcriptEntries) {
    const role = normalizeText(entry?.role).toLowerCase();
    const kind = normalizeText(entry?.kind).toLowerCase();
    const metadata = normalizeObject(entry?.metadata);
    const transcriptMessageId = Number(entry?.id);
    const messageId =
      Number.isInteger(transcriptMessageId) && transcriptMessageId > 0
        ? `transcript_${transcriptMessageId}`
        : buildId("transcript");

    if (kind === "chat" && (role === "user" || role === "assistant")) {
      const contentStored = entry?.contentText != null;
      const messageText = contentStored ? String(entry?.contentText || "") : REDACTED_CONTENT_PLACEHOLDER;
      restoredMessages.push({
        id: messageId,
        role,
        kind: "chat",
        text: messageText,
        status: contentStored ? "done" : "restricted"
      });
      continue;
    }

    if (kind === "error") {
      const errorText = entry?.contentText != null ? String(entry.contentText || "") : REDACTED_CONTENT_PLACEHOLDER;
      restoredMessages.push({
        id: messageId,
        role: "assistant",
        kind: "chat",
        text: errorText,
        status: "error"
      });
      continue;
    }

    if (kind === "tool_call") {
      const toolCallId = normalizeText(metadata.toolCallId) || `tool_call_${messageId}`;
      const toolName = normalizeToolName(metadata.tool);
      const toolEvent = ensureToolEvent(toolCallId, toolName);
      toolEvent.arguments = String(entry?.contentText || "");
      toolEvent.status = "pending";
      restoredMessages.push({
        id: messageId,
        role: "assistant",
        kind: "tool_event",
        text: buildToolCallSummary({
          name: toolName
        }),
        status: "tool_call"
      });
      continue;
    }

    if (kind === "tool_result") {
      const parsedPayload = parseToolResultPayload(entry?.contentText);
      const toolCallId = normalizeText(metadata.toolCallId || parsedPayload.toolCallId) || `tool_result_${messageId}`;
      const toolName = normalizeToolName(metadata.tool || parsedPayload.tool);
      const toolEvent = ensureToolEvent(toolCallId, toolName);
      const failed = parsedPayload.ok === false || metadata.ok === false;
      toolEvent.status = failed ? "failed" : "done";
      toolEvent.result = failed ? null : (parsedPayload.result ?? null);
      toolEvent.error = failed ? parsedPayload.error || metadata.error || null : null;
      restoredMessages.push({
        id: messageId,
        role: "assistant",
        kind: "tool_event",
        text: buildToolResultSummary({
          name: toolName,
          ok: !failed,
          error: toolEvent.error
        }),
        status: "tool_result"
      });
    }
  }

  return {
    messages: restoredMessages,
    pendingToolEvents: Array.from(toolEventsById.values())
  };
}

function useAssistantRuntime({ api, useWorkspaceStore, resolveSurfaceFromPathname }, { policy } = {}) {
  const streamTimeoutMs = Number(policy.streamTimeoutMs);
  const historyPageSize = Number(policy.historyPageSize);
  const restoreMessagesPageSize = Number(policy.restoreMessagesPageSize);
  const workspaceStore = useWorkspaceStore();
  const queryClient = useQueryClient();
  const messages = ref([]);
  const input = ref("");
  const sendOnEnter = ref(true);
  const isStreaming = ref(false);
  const isRestoringConversation = ref(false);
  const error = ref("");
  const pendingToolEvents = ref([]);
  const abortController = ref(null);
  const conversationId = ref(null);
  const currentSurfaceId = ref(resolveCurrentSurfaceId(resolveSurfaceFromPathname));

  const workspaceSlug = computed(() => {
    return String(workspaceStore.activeWorkspace?.slug || workspaceStore.activeWorkspaceSlug || "").trim();
  });

  const workspaceId = computed(() => {
    const parsed = Number(workspaceStore.activeWorkspace?.id);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  });

  const workspaceScope = computed(() => ({
    workspaceSlug: workspaceSlug.value,
    workspaceId: workspaceId.value
  }));

  const hasWorkspaceScope = computed(() => workspaceId.value > 0 || Boolean(workspaceSlug.value));

  const conversationHistoryQuery = useQuery({
    queryKey: computed(() =>
      assistantConversationsListQueryKey(workspaceScope.value, {
        page: HISTORY_PAGE,
        pageSize: historyPageSize
      })
    ),
    queryFn: () =>
      api.ai.listConversations({
        page: HISTORY_PAGE,
        pageSize: historyPageSize
      }),
    enabled: computed(() => hasWorkspaceScope.value),
    refetchOnWindowFocus: false
  });

  const conversationHistory = computed(() => {
    return Array.isArray(conversationHistoryQuery.data.value?.entries)
      ? conversationHistoryQuery.data.value.entries
      : [];
  });

  const conversationHistoryLoading = computed(() => conversationHistoryQuery.isFetching.value);
  const conversationHistoryError = computed(() => String(conversationHistoryQuery.error.value?.message || ""));
  const activeConversationId = computed(() => normalizeText(conversationId.value));
  const isAdminSurface = computed(() => currentSurfaceId.value === "admin");
  const canSend = computed(
    () => !isStreaming.value && !isRestoringConversation.value && normalizeText(input.value).length > 0
  );
  const canStartNewConversation = computed(() => !isStreaming.value);

  function appendMessage(payload) {
    messages.value = [...messages.value, payload];
  }

  function findMessageById(messageId) {
    return messages.value.find((message) => message.id === messageId) || null;
  }

  function updateMessage(messageId, updater) {
    messages.value = messages.value.map((message) => {
      if (message.id !== messageId) {
        return message;
      }

      const patch = typeof updater === "function" ? updater(message) : updater;
      return {
        ...message,
        ...(patch && typeof patch === "object" ? patch : {})
      };
    });
  }

  function appendAssistantDelta(assistantMessageId, delta) {
    const textDelta = String(delta || "");
    if (!textDelta) {
      return;
    }

    updateMessage(assistantMessageId, (message) => ({
      text: `${String(message.text || "")}${textDelta}`,
      status: "streaming"
    }));
  }

  function finalizeAssistantMessage(assistantMessageId, text) {
    const normalizedText = String(text || "");
    updateMessage(assistantMessageId, (message) => ({
      text: normalizedText || String(message?.text || ""),
      status: "done"
    }));
  }

  function markAssistantError(assistantMessageId) {
    updateMessage(assistantMessageId, {
      status: "error"
    });
  }

  function markAssistantCanceled(assistantMessageId) {
    updateMessage(assistantMessageId, {
      status: "canceled"
    });
  }

  function appendToolTimelineMessage(eventType, eventPayload) {
    const text = eventType === "tool_call" ? buildToolCallSummary(eventPayload) : buildToolResultSummary(eventPayload);
    appendMessage({
      id: buildId("tool_message"),
      role: "assistant",
      kind: "tool_event",
      text,
      status: eventType
    });
  }

  function addPendingToolEvent(payload) {
    pendingToolEvents.value = [
      ...pendingToolEvents.value,
      {
        id: String(payload?.toolCallId || buildId("tool_call")),
        name: normalizeToolName(payload?.name),
        arguments: String(payload?.arguments || ""),
        status: "pending",
        result: null,
        error: null
      }
    ];
  }

  function resolvePendingToolEvent(payload) {
    const toolCallId = String(payload?.toolCallId || "").trim();
    if (!toolCallId) {
      return;
    }

    pendingToolEvents.value = pendingToolEvents.value.map((event) => {
      if (event.id !== toolCallId) {
        return event;
      }

      return {
        ...event,
        status: payload?.ok === false ? "failed" : "done",
        result: payload?.ok === false ? null : payload?.result,
        error: payload?.ok === false ? payload?.error || null : null
      };
    });
  }

  function cancelStream() {
    if (!abortController.value) {
      return;
    }

    abortController.value.abort();
  }

  function handleInputKeydown(event) {
    if (!sendOnEnter.value) {
      return;
    }

    if (
      event?.key === "Enter" &&
      event?.shiftKey !== true &&
      event?.ctrlKey !== true &&
      event?.metaKey !== true &&
      event?.altKey !== true
    ) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function refreshConversationHistory() {
    if (!hasWorkspaceScope.value) {
      return;
    }

    await conversationHistoryQuery.refetch();
  }

  async function invalidateConversationHistory() {
    if (!hasWorkspaceScope.value) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: assistantWorkspaceScopeQueryKey(workspaceScope.value)
    });
  }

  async function selectConversationById(value) {
    const normalizedConversationId = normalizeText(value);
    if (!normalizedConversationId || isStreaming.value || isRestoringConversation.value || !hasWorkspaceScope.value) {
      return;
    }

    const parsedConversationId = Number(normalizedConversationId);
    if (!Number.isInteger(parsedConversationId) || parsedConversationId < 1) {
      return;
    }

    const previousConversationId = conversationId.value;
    conversationId.value = normalizedConversationId;
    isRestoringConversation.value = true;
    error.value = "";

    try {
      const response = await queryClient.fetchQuery({
        queryKey: assistantConversationMessagesQueryKey(workspaceScope.value, parsedConversationId, {
          page: RESTORE_MESSAGES_PAGE,
          pageSize: restoreMessagesPageSize
        }),
        queryFn: () =>
          api.ai.getConversationMessages(parsedConversationId, {
            page: RESTORE_MESSAGES_PAGE,
            pageSize: restoreMessagesPageSize
          })
      });

      const restored = mapTranscriptEntriesToAssistantState(response?.entries);
      messages.value = restored.messages;
      pendingToolEvents.value = restored.pendingToolEvents;
      input.value = "";
      error.value = "";
    } catch (loadError) {
      conversationId.value = previousConversationId;
      error.value = normalizeText(loadError?.message) || "Unable to load conversation.";
    } finally {
      isRestoringConversation.value = false;
    }
  }

  async function selectConversation(conversation) {
    await selectConversationById(conversation?.id);
  }

  function startNewConversation() {
    if (isStreaming.value) {
      cancelStream();
    }

    messages.value = [];
    pendingToolEvents.value = [];
    input.value = "";
    error.value = "";
    conversationId.value = null;
    isStreaming.value = false;
    abortController.value = null;
    isRestoringConversation.value = false;
  }

  async function sendMessage() {
    const normalizedInput = normalizeText(input.value);
    if (!normalizedInput || isStreaming.value || isRestoringConversation.value) {
      return;
    }

    const history = buildHistory(messages.value);
    const messageId = buildId("message");
    const assistantMessageId = buildId("assistant");

    appendMessage({
      id: buildId("user"),
      role: "user",
      kind: "chat",
      text: normalizedInput,
      status: "done"
    });

    appendMessage({
      id: assistantMessageId,
      role: "assistant",
      kind: "chat",
      text: "",
      status: "streaming"
    });

    input.value = "";
    error.value = "";
    isStreaming.value = true;
    const streamAbortController = new AbortController();
    abortController.value = streamAbortController;
    let streamTimedOut = false;
    let streamEventCount = 0;
    let streamDone = false;
    const streamTimeoutHandle =
      typeof setTimeout === "function"
        ? setTimeout(() => {
            streamTimedOut = true;
            streamAbortController.abort();
          }, streamTimeoutMs)
        : null;

    try {
      await api.ai.streamChat(
        {
          messageId,
          conversationId: conversationId.value || undefined,
          input: normalizedInput,
          history
        },
        {
          signal: streamAbortController.signal,
          onEvent(event) {
            streamEventCount += 1;
            const eventType = normalizeAssistantStreamEventType(event?.type, "");

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.META && Object.hasOwn(event || {}, "conversationId")) {
              conversationId.value = event?.conversationId ? String(event.conversationId) : null;
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_DELTA) {
              appendAssistantDelta(assistantMessageId, event?.delta);
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_MESSAGE) {
              finalizeAssistantMessage(assistantMessageId, event?.text);
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.TOOL_CALL) {
              addPendingToolEvent(event);
              appendToolTimelineMessage("tool_call", event);
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.TOOL_RESULT) {
              resolvePendingToolEvent(event);
              appendToolTimelineMessage("tool_result", event);
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.ERROR) {
              error.value = normalizeText(event?.message) || "Assistant request failed.";
              markAssistantError(assistantMessageId);
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.DONE) {
              streamDone = true;
              updateMessage(assistantMessageId, (message) => ({
                status: message.status === "error" ? "error" : "done"
              }));
            }
          }
        }
      );

      const assistantMessage = findMessageById(assistantMessageId);
      const assistantText = normalizeText(assistantMessage?.text);
      if (!assistantText) {
        if (streamEventCount < 1) {
          error.value = "Assistant stream returned no events.";
        } else if (!streamDone) {
          error.value = "Assistant stream ended before completion.";
        } else {
          error.value = "Assistant returned no output.";
        }
        markAssistantError(assistantMessageId);
      } else {
        updateMessage(assistantMessageId, (message) => ({
          status: message.status === "streaming" ? "done" : message.status
        }));
      }
    } catch (streamError) {
      if (streamTimedOut) {
        error.value = "Assistant request timed out.";
        markAssistantError(assistantMessageId);
      } else if (String(streamError?.name || "") !== "AbortError") {
        error.value = normalizeText(streamError?.message) || "Assistant request failed.";
        markAssistantError(assistantMessageId);
      } else {
        markAssistantCanceled(assistantMessageId);
      }
    } finally {
      if (streamTimeoutHandle != null && typeof clearTimeout === "function") {
        clearTimeout(streamTimeoutHandle);
      }
      abortController.value = null;
      isStreaming.value = false;
      await invalidateConversationHistory();
      await refreshConversationHistory();
    }
  }

  function formatConversationStartedAt(value) {
    return normalizeDateTime(value) || "unknown";
  }

  return {
    meta: {
      formatConversationStartedAt,
      normalizeConversationStatus
    },
    state: {
      messages,
      input,
      sendOnEnter,
      isStreaming,
      isRestoringConversation,
      error,
      pendingToolEvents,
      abortController,
      conversationId,
      activeConversationId,
      conversationHistory,
      conversationHistoryLoading,
      conversationHistoryError,
      currentSurfaceId,
      isAdminSurface,
      canSend,
      canStartNewConversation
    },
    actions: {
      sendMessage,
      handleInputKeydown,
      cancelStream,
      clearConversation: startNewConversation,
      startNewConversation,
      selectConversation,
      selectConversationById,
      refreshConversationHistory
    }
  };
}

const assistantRuntimeTestables = {
  HISTORY_PAGE,
  RESTORE_MESSAGES_PAGE,
  REDACTED_CONTENT_PLACEHOLDER,
  buildHistory,
  buildId,
  normalizeToolName,
  buildToolCallSummary,
  buildToolResultSummary,
  mapTranscriptEntriesToAssistantState,
  normalizeConversationStatus,
  resolveAssistantRuntimePolicy
};

function resolveAssistantRuntimeDependencies(deps = {}) {
  const source = deps && typeof deps === "object" ? deps : {};

  return {
    api: source.api && typeof source.api === "object" ? source.api : null,
    useWorkspaceStore:
      typeof source.useWorkspaceStore === "function" ? source.useWorkspaceStore : DEFAULT_USE_WORKSPACE_STORE,
    resolveSurfaceFromPathname:
      typeof source.resolveSurfaceFromPathname === "function"
        ? source.resolveSurfaceFromPathname
        : DEFAULT_RESOLVE_SURFACE_FROM_PATHNAME
  };
}

function assertAssistantRuntimeDependencies({ api }) {
  const requiredMethods = ["listConversations", "getConversationMessages", "streamChat"];
  const missingMethods = requiredMethods.filter((methodName) => typeof api?.ai?.[methodName] !== "function");
  if (missingMethods.length > 0) {
    throw new Error(
      `assistant-client-runtime missing required api.ai methods: ${missingMethods.join(", ")}`
    );
  }
}

function resolveAssistantRuntimePolicy(policy) {
  const source = policy && typeof policy === "object" ? policy : null;
  if (!source) {
    throw new Error("assistant-client-runtime missing required policy object.");
  }

  const normalized = {
    streamTimeoutMs: toPositiveInteger(source.streamTimeoutMs),
    historyPageSize: toPositiveInteger(source.historyPageSize),
    restoreMessagesPageSize: toPositiveInteger(source.restoreMessagesPageSize)
  };

  const invalidFields = Object.entries(normalized)
    .filter(([, value]) => value < 1)
    .map(([key]) => key);
  if (invalidFields.length > 0) {
    throw new Error(`assistant-client-runtime policy fields must be positive integers: ${invalidFields.join(", ")}`);
  }

  return Object.freeze(normalized);
}

function buildBoundAssistantRuntimeTestables(policy) {
  return Object.freeze({
    ...assistantRuntimeTestables,
    ASSISTANT_STREAM_TIMEOUT_MS: policy.streamTimeoutMs,
    HISTORY_PAGE_SIZE: policy.historyPageSize,
    RESTORE_MESSAGES_PAGE_SIZE: policy.restoreMessagesPageSize,
    policy
  });
}

function createAssistantRuntime(deps = {}) {
  const runtimeDeps = resolveAssistantRuntimeDependencies(deps);
  const runtimePolicy = resolveAssistantRuntimePolicy(deps?.policy);
  assertAssistantRuntimeDependencies(runtimeDeps);
  const runtimeTestables = buildBoundAssistantRuntimeTestables(runtimePolicy);

  function useBoundAssistantRuntime() {
    return useAssistantRuntime(runtimeDeps, {
      policy: runtimePolicy
    });
  }

  return {
    useAssistantRuntime: useBoundAssistantRuntime,
    useAssistantView: useBoundAssistantRuntime,
    assistantRuntimeTestables: runtimeTestables
  };
}

export { createAssistantRuntime, assistantRuntimeTestables };
