import { computed, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useWorkspaceRouteContext } from "@jskit-ai/users-web/client/composables/useWorkspaceRouteContext";
import { usePagedCollection } from "@jskit-ai/users-web/client/composables/usePagedCollection";
import {
  MAX_INPUT_CHARS,
  ASSISTANT_STREAM_EVENT_TYPES,
  ASSISTANT_TRANSCRIPT_CHANGED_EVENT,
  MAX_HISTORY_MESSAGES,
  assistantConversationMessagesQueryKey,
  assistantConversationsListQueryKey,
  assistantWorkspaceScopeQueryKey,
  normalizeAssistantStreamEventType,
  toPositiveInteger
} from "../../shared/index.js";
import { assistantHttpClient } from "../lib/assistantHttpClient.js";
import { createAssistantWorkspaceApi } from "../lib/assistantApi.js";

const DEFAULT_STREAM_TIMEOUT_MS = 120_000;
const DEFAULT_HISTORY_PAGE_SIZE = 20;
const DEFAULT_MESSAGES_PAGE_SIZE = 200;
const DEFAULT_HISTORY_STALE_TIME_MS = 60_000;
const HISTORY_PAGE = 1;
const RESTORE_MESSAGES_PAGE = 1;
const ACTIVE_CONVERSATION_STORAGE_PREFIX = "assistant.activeConversationId";

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function buildActiveConversationStorageKey(workspaceSlug) {
  const normalizedWorkspaceSlug = normalizeText(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return "";
  }

  return `${ACTIVE_CONVERSATION_STORAGE_PREFIX}:${normalizedWorkspaceSlug}`;
}

function readStoredActiveConversationId(workspaceSlug) {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return 0;
  }

  const storageKey = buildActiveConversationStorageKey(workspaceSlug);
  if (!storageKey) {
    return 0;
  }

  try {
    return toPositiveInteger(window.sessionStorage.getItem(storageKey), 0);
  } catch {
    return 0;
  }
}

function writeStoredActiveConversationId(workspaceSlug, conversationId) {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  const storageKey = buildActiveConversationStorageKey(workspaceSlug);
  if (!storageKey) {
    return;
  }

  const normalizedConversationId = toPositiveInteger(conversationId, 0);
  try {
    if (normalizedConversationId > 0) {
      window.sessionStorage.setItem(storageKey, String(normalizedConversationId));
      return;
    }

    window.sessionStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

function buildId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeToolName(value) {
  return normalizeText(value) || "tool";
}

function normalizeConversationStatus(value) {
  const status = normalizeText(value).toLowerCase();
  return status || "unknown";
}

function formatConversationStartedAt(value) {
  const source = normalizeText(value);
  if (!source) {
    return "unknown";
  }

  const date = new Date(source);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toLocaleString();
}

function parseToolResultPayload(value) {
  if (!value) {
    return {};
  }

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function buildHistory(messages) {
  const normalizedHistory = (Array.isArray(messages) ? messages : [])
    .filter((message) => {
      if (!message || typeof message !== "object") {
        return false;
      }
      if (message.kind !== "chat") {
        return false;
      }
      if (message.role !== "user" && message.role !== "assistant") {
        return false;
      }
      if (normalizeText(message.status).toLowerCase() !== "done") {
        return false;
      }
      return Boolean(normalizeText(message.text));
    })
    .map((message) => ({
      role: message.role,
      content: String(message.text || "").slice(0, MAX_INPUT_CHARS)
    }));

  return normalizedHistory.slice(-MAX_HISTORY_MESSAGES);
}

function mapTranscriptEntriesToAssistantState(entries) {
  const sourceEntries = Array.isArray(entries) ? entries : [];
  const messages = [];
  const toolEventsById = new Map();

  function ensureToolEvent(toolCallId, toolName) {
    const key = normalizeText(toolCallId) || buildId("tool_call");
    if (toolEventsById.has(key)) {
      return toolEventsById.get(key);
    }

    const next = {
      id: key,
      name: normalizeToolName(toolName),
      arguments: "",
      status: "pending",
      result: null,
      error: null
    };
    toolEventsById.set(key, next);
    return next;
  }

  for (const entry of sourceEntries) {
    const role = normalizeText(entry?.role).toLowerCase();
    const kind = normalizeText(entry?.kind).toLowerCase();
    const metadata = normalizeObject(entry?.metadata);
    const messageId = Number(entry?.id) > 0 ? `transcript_${entry.id}` : buildId("transcript");

    if (kind === "chat" && (role === "user" || role === "assistant")) {
      messages.push({
        id: messageId,
        role,
        kind: "chat",
        text: entry?.contentText == null ? "" : String(entry.contentText),
        status: "done"
      });
      continue;
    }

    if (kind === "tool_call") {
      const toolCallId = normalizeText(metadata.toolCallId) || `tool_call_${messageId}`;
      const toolName = normalizeToolName(metadata.tool);
      const toolEvent = ensureToolEvent(toolCallId, toolName);
      toolEvent.arguments = String(entry?.contentText || "");
      toolEvent.status = "pending";
      continue;
    }

    if (kind === "tool_result") {
      const parsedResult = parseToolResultPayload(entry?.contentText);
      const toolCallId = normalizeText(metadata.toolCallId || parsedResult.toolCallId) || `tool_result_${messageId}`;
      const toolName = normalizeToolName(metadata.tool || parsedResult.tool);
      const toolEvent = ensureToolEvent(toolCallId, toolName);
      const failed = parsedResult.ok === false || metadata.ok === false;
      toolEvent.status = failed ? "failed" : "done";
      toolEvent.result = failed ? null : parsedResult.result;
      toolEvent.error = failed ? parsedResult.error || metadata.error || null : null;
    }
  }

  return {
    messages,
    pendingToolEvents: [...toolEventsById.values()]
  };
}

function resolveWorkspaceScope(bootstrapData = {}, workspaceSlug = "") {
  const activeWorkspace = bootstrapData?.workspace && typeof bootstrapData.workspace === "object"
    ? bootstrapData.workspace
    : bootstrapData?.activeWorkspace && typeof bootstrapData.activeWorkspace === "object"
      ? bootstrapData.activeWorkspace
    : null;

  return {
    workspaceSlug: normalizeText(workspaceSlug),
    workspaceId: toPositiveInteger(activeWorkspace?.id, 0)
  };
}

function resolveRuntimePolicy() {
  const appConfig = getClientAppConfig();
  const assistantConfig = normalizeObject(appConfig?.assistant);

  return Object.freeze({
    timeoutMs: toPositiveInteger(assistantConfig.timeoutMs, DEFAULT_STREAM_TIMEOUT_MS),
    historyPageSize: toPositiveInteger(assistantConfig.historyPageSize, DEFAULT_HISTORY_PAGE_SIZE),
    restoreMessagesPageSize: toPositiveInteger(assistantConfig.restoreMessagesPageSize, DEFAULT_MESSAGES_PAGE_SIZE),
    historyStaleTimeMs: toNonNegativeInteger(assistantConfig.historyStaleTimeMs, DEFAULT_HISTORY_STALE_TIME_MS)
  });
}

function createRuntimeApi(overrideApi = null) {
  if (overrideApi && typeof overrideApi.streamChat === "function") {
    return overrideApi;
  }

  return createAssistantWorkspaceApi({
    request: assistantHttpClient.request,
    requestStream: assistantHttpClient.requestStream
  });
}

function useAssistantWorkspaceRuntime({ api = null } = {}) {
  const runtimePolicy = resolveRuntimePolicy();
  const runtimeApi = createRuntimeApi(api);
  const queryClient = useQueryClient();
  const { workspaceSlugFromRoute, currentSurfaceId, placementContext } = useWorkspaceRouteContext();

  const messages = ref([]);
  const input = ref("");
  const isStreaming = ref(false);
  const isRestoringConversation = ref(false);
  const error = ref("");
  const pendingToolEvents = ref([]);
  const conversationId = ref(null);
  const abortController = ref(null);

  const placementSnapshot = computed(() => normalizeObject(placementContext.value));
  const workspaceScope = computed(() => resolveWorkspaceScope(placementSnapshot.value, workspaceSlugFromRoute.value));
  const hasWorkspaceScope = computed(() => Boolean(workspaceScope.value.workspaceSlug));
  const activeConversationId = computed(() => normalizeText(conversationId.value));
  const isAdminSurface = computed(() => currentSurfaceId.value === "admin");
  const canSend = computed(() => !isStreaming.value && !isRestoringConversation.value && Boolean(normalizeText(input.value)));
  const canStartNewConversation = computed(() => !isStreaming.value);

  const conversationHistoryCollection = usePagedCollection({
    queryKey: computed(() =>
      assistantConversationsListQueryKey(workspaceScope.value, {
        pageSize: runtimePolicy.historyPageSize
      })
    ),
    queryFn: ({ pageParam = HISTORY_PAGE }) =>
      runtimeApi.listConversations(workspaceScope.value.workspaceSlug, {
        page: pageParam,
        pageSize: runtimePolicy.historyPageSize
      }),
    initialPageParam: HISTORY_PAGE,
    getNextPageParam(lastPage) {
      const page = toPositiveInteger(lastPage?.page, HISTORY_PAGE);
      const totalPages = toPositiveInteger(lastPage?.totalPages, HISTORY_PAGE);
      if (page >= totalPages) {
        return undefined;
      }
      return page + 1;
    },
    selectItems(page) {
      return Array.isArray(page?.entries) ? page.entries : [];
    },
    dedupeBy(entry) {
      const conversationNumericId = toPositiveInteger(entry?.id, 0);
      return conversationNumericId > 0 ? String(conversationNumericId) : normalizeText(entry?.id);
    },
    enabled: computed(() => hasWorkspaceScope.value),
    queryOptions: {
      staleTime: runtimePolicy.historyStaleTimeMs,
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    fallbackLoadError: "Unable to load conversation history."
  });

  const conversationHistory = conversationHistoryCollection.items;
  const conversationHistoryLoading = computed(
    () => Boolean(conversationHistoryCollection.isLoading.value && !conversationHistoryCollection.isLoadingMore.value)
  );
  const conversationHistoryLoadingMore = conversationHistoryCollection.isLoadingMore;
  const conversationHistoryHasMore = conversationHistoryCollection.hasMore;
  const conversationHistoryError = conversationHistoryCollection.loadError;

  watch(conversationId, (nextConversationId, previousConversationId) => {
    const workspaceSlug = workspaceScope.value.workspaceSlug;
    if (!workspaceSlug) {
      return;
    }

    const nextConversationNumericId = toPositiveInteger(nextConversationId, 0);
    if (nextConversationNumericId > 0) {
      writeStoredActiveConversationId(workspaceSlug, nextConversationNumericId);
      return;
    }

    const previousConversationNumericId = toPositiveInteger(previousConversationId, 0);
    if (previousConversationNumericId > 0) {
      writeStoredActiveConversationId(workspaceSlug, 0);
    }
  });

  watch(
    [
      hasWorkspaceScope,
      conversationHistoryLoading,
      workspaceScope,
      conversationId,
      conversationHistory,
      isRestoringConversation
    ],
    async ([
      nextHasWorkspaceScope,
      nextConversationHistoryLoading,
      nextWorkspaceScope,
      nextConversationId,
      nextConversationHistory,
      nextIsRestoringConversation
    ]) => {
      if (!nextHasWorkspaceScope || nextConversationHistoryLoading || nextIsRestoringConversation) {
        return;
      }

      const activeConversationId = toPositiveInteger(nextConversationId, 0);
      if (activeConversationId > 0) {
        return;
      }

      const sourceEntries = Array.isArray(nextConversationHistory) ? nextConversationHistory : [];
      if (sourceEntries.length < 1) {
        return;
      }

      const storedConversationId = readStoredActiveConversationId(nextWorkspaceScope?.workspaceSlug);
      if (!storedConversationId) {
        return;
      }

      const hasStoredConversation = sourceEntries.some(
        (entry) => toPositiveInteger(entry?.id, 0) === storedConversationId
      );
      if (!hasStoredConversation) {
        writeStoredActiveConversationId(nextWorkspaceScope?.workspaceSlug, 0);
        return;
      }

      await selectConversationById(storedConversationId);
    },
    {
      immediate: true
    }
  );

  function appendMessage(payload) {
    messages.value = [...messages.value, payload];
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

  function findMessage(messageId) {
    return messages.value.find((entry) => entry.id === messageId) || null;
  }

  async function invalidateConversationScope() {
    if (!hasWorkspaceScope.value) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: assistantWorkspaceScopeQueryKey(workspaceScope.value)
    });
  }

  async function refreshConversationHistory() {
    if (!hasWorkspaceScope.value) {
      return;
    }

    await conversationHistoryCollection.reload();
  }

  async function loadMoreConversationHistory() {
    await conversationHistoryCollection.loadMore();
  }

  async function selectConversationById(nextConversationId) {
    const normalizedConversationId = normalizeText(nextConversationId);
    if (!normalizedConversationId || isStreaming.value || isRestoringConversation.value || !hasWorkspaceScope.value) {
      return;
    }

    const parsedConversationId = toPositiveInteger(normalizedConversationId, 0);
    if (!parsedConversationId) {
      return;
    }

    const previousConversationId = conversationId.value;
    conversationId.value = String(parsedConversationId);
    isRestoringConversation.value = true;
    error.value = "";

    try {
      const response = await queryClient.fetchQuery({
        queryKey: assistantConversationMessagesQueryKey(workspaceScope.value, parsedConversationId, {
          page: RESTORE_MESSAGES_PAGE,
          pageSize: runtimePolicy.restoreMessagesPageSize
        }),
        queryFn: () =>
          runtimeApi.getConversationMessages(workspaceScope.value.workspaceSlug, parsedConversationId, {
            page: RESTORE_MESSAGES_PAGE,
            pageSize: runtimePolicy.restoreMessagesPageSize
          })
      });

      const restored = mapTranscriptEntriesToAssistantState(response?.entries);
      messages.value = restored.messages;
      pendingToolEvents.value = restored.pendingToolEvents;
      input.value = "";
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
    if (abortController.value) {
      abortController.value.abort();
    }

    messages.value = [];
    pendingToolEvents.value = [];
    input.value = "";
    error.value = "";
    conversationId.value = null;
    writeStoredActiveConversationId(workspaceScope.value.workspaceSlug, 0);
    isStreaming.value = false;
    isRestoringConversation.value = false;
    abortController.value = null;
  }

  function handleInputKeydown(event) {
    if (event?.key === "Enter" && isStreaming.value) {
      event.preventDefault();
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

  function cancelStream() {
    if (abortController.value) {
      abortController.value.abort();
    }
  }

  async function sendMessage() {
    const normalizedInput = normalizeText(input.value).slice(0, MAX_INPUT_CHARS);
    if (!normalizedInput || isStreaming.value || isRestoringConversation.value || !hasWorkspaceScope.value) {
      return;
    }

    const messageId = buildId("message");
    const assistantMessageId = buildId("assistant");
    const history = buildHistory(messages.value);
    const parsedConversationId = toPositiveInteger(conversationId.value, 0);

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

    const streamTimeout = setTimeout(() => {
      streamAbortController.abort();
    }, runtimePolicy.timeoutMs);

    let streamDoneStatus = "";

    try {
      await runtimeApi.streamChat(
        workspaceScope.value.workspaceSlug,
        {
          messageId,
          ...(parsedConversationId > 0 ? { conversationId: parsedConversationId } : {}),
          input: normalizedInput,
          history
        },
        {
          signal: streamAbortController.signal,
          onEvent(event) {
            const eventType = normalizeAssistantStreamEventType(event?.type, "");

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.META && Object.hasOwn(event || {}, "conversationId")) {
              conversationId.value = event?.conversationId ? String(event.conversationId) : null;
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_DELTA) {
              const delta = String(event?.delta || "");
              if (!delta) {
                return;
              }

              updateMessage(assistantMessageId, (message) => ({
                text: `${String(message?.text || "")}${delta}`,
                status: "streaming"
              }));
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.ASSISTANT_MESSAGE) {
              const text = String(event?.text || "");
              updateMessage(assistantMessageId, {
                text,
                status: "done"
              });
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.TOOL_CALL) {
              const toolCallId = normalizeText(event?.toolCallId) || buildId("tool_call");
              pendingToolEvents.value = [
                ...pendingToolEvents.value,
                {
                  id: toolCallId,
                  name: normalizeToolName(event?.name),
                  arguments: String(event?.arguments || ""),
                  status: "pending",
                  result: null,
                  error: null
                }
              ];
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.TOOL_RESULT) {
              const toolCallId = normalizeText(event?.toolCallId);
              if (toolCallId) {
                pendingToolEvents.value = pendingToolEvents.value.map((toolEvent) => {
                  if (toolEvent.id !== toolCallId) {
                    return toolEvent;
                  }

                  const failed = event?.ok === false;
                  return {
                    ...toolEvent,
                    status: failed ? "failed" : "done",
                    result: failed ? null : event?.result,
                    error: failed ? event?.error || null : null
                  };
                });
              }
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.ERROR) {
              error.value = normalizeText(event?.message) || "Assistant request failed.";
              updateMessage(assistantMessageId, {
                status: "error"
              });
              return;
            }

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.DONE) {
              streamDoneStatus = normalizeText(event?.status).toLowerCase();
            }
          }
        }
      );

      const assistantMessage = findMessage(assistantMessageId);
      const assistantMessageText = normalizeText(assistantMessage?.text);
      if (!assistantMessageText && streamDoneStatus !== "aborted") {
        error.value = error.value || "Assistant returned no output.";
        updateMessage(assistantMessageId, {
          status: "error"
        });
      } else if (streamDoneStatus === "aborted") {
        updateMessage(assistantMessageId, {
          status: "canceled"
        });
      } else {
        updateMessage(assistantMessageId, (message) => ({
          status: message.status === "streaming" ? "done" : message.status
        }));
      }
    } catch (streamError) {
      if (String(streamError?.name || "") === "AbortError") {
        updateMessage(assistantMessageId, {
          status: "canceled"
        });
      } else {
        error.value = normalizeText(streamError?.message) || "Assistant request failed.";
        updateMessage(assistantMessageId, {
          status: "error"
        });
      }
    } finally {
      clearTimeout(streamTimeout);
      abortController.value = null;
      isStreaming.value = false;
      await invalidateConversationScope();
      await refreshConversationHistory();
    }
  }

  useRealtimeEvent({
    event: ASSISTANT_TRANSCRIPT_CHANGED_EVENT,
    enabled: computed(() => hasWorkspaceScope.value),
    matches({ payload }) {
      if (!payload || typeof payload !== "object") {
        return true;
      }

      const scope = payload.scope && typeof payload.scope === "object" ? payload.scope : {};
      const workspaceIdFromEvent = toPositiveInteger(scope.id || scope.workspaceId, 0);
      const workspaceId = toPositiveInteger(workspaceScope.value.workspaceId, 0);
      if (workspaceIdFromEvent > 0 && workspaceId > 0) {
        return workspaceIdFromEvent === workspaceId;
      }

      return true;
    },
    async onEvent({ payload }) {
      await invalidateConversationScope();
      const incomingConversationId = toPositiveInteger(payload?.conversationId, 0);
      const activeId = toPositiveInteger(conversationId.value, 0);
      if (!incomingConversationId || incomingConversationId !== activeId || !activeId) {
        return;
      }

      await selectConversationById(activeId);
    }
  });

  const viewer = computed(() => {
    const user = normalizeObject(placementSnapshot.value.user);

    return {
      displayName: normalizeText(user.displayName || user.name) || "You",
      avatarUrl: normalizeText(user.avatarUrl)
    };
  });

  return Object.freeze({
    meta: {
      normalizeConversationStatus,
      formatConversationStartedAt
    },
    state: {
      messages,
      input,
      isStreaming,
      isRestoringConversation,
      error,
      pendingToolEvents,
      conversationId,
      activeConversationId,
      conversationHistory,
      conversationHistoryLoading,
      conversationHistoryLoadingMore,
      conversationHistoryHasMore,
      conversationHistoryError,
      isAdminSurface,
      canSend,
      canStartNewConversation
    },
    actions: {
      sendMessage,
      handleInputKeydown,
      cancelStream,
      startNewConversation,
      clearConversation: startNewConversation,
      selectConversation,
      selectConversationById,
      refreshConversationHistory,
      loadMoreConversationHistory
    },
    viewer
  });
}

export { useAssistantWorkspaceRuntime };
