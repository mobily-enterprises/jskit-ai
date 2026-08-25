import { computed, nextTick, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { normalizeObject, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { buildAssistantApiPath } from "@jskit-ai/assistant-core/shared";
import {
  ASSISTANT_STREAM_EVENT_TYPES,
  MAX_INPUT_CHARS,
  assistantConversationMessagesQueryKey,
  assistantConversationsListQueryKey,
  assistantScopeQueryKey,
  normalizeAssistantStreamEventType,
  normalizeConversationStatus as normalizeAssistantConversationStatus,
  toPositiveInteger
} from "@jskit-ai/assistant-core/shared";
import {
  assistantHttpClient,
  createAssistantApi
} from "@jskit-ai/assistant-core/client";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { usePagedCollection } from "@jskit-ai/http-web/client/composables/usePagedCollection";
import { useSurfaceRouteContext } from "@jskit-ai/shell-web/client/navigation/useSurfaceRouteContext";
import { resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";
import {
  buildHistory,
  buildId,
  interruptPendingToolEvents,
  mapTranscriptEntriesToAssistantState,
  normalizeToolName
} from "../support/assistantRuntimeState.js";
import { insertTextAtSelection } from "../support/composerInputSupport.js";
import {
  loadConversationTranscript,
  resolveConversationRestorePolicy
} from "../support/conversationRestoreSupport.js";
import { useWorkspaceWebScopeSupport } from "../support/workspaceScopeSupport.js";

const DEFAULT_STREAM_TIMEOUT_MS = 120_000;
const DEFAULT_HISTORY_PAGE_SIZE = 20;
const DEFAULT_HISTORY_STALE_TIME_MS = 60_000;

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function buildScopeStorageKey(scope = {}) {
  const runtimeSurfaceId = normalizeText(scope?.targetSurfaceId).toLowerCase() || "assistant";
  const workspaceSlug = normalizeText(scope?.workspaceSlug).toLowerCase() || "global";
  return `assistant.activeConversationId:${runtimeSurfaceId}:${workspaceSlug}`;
}

function readStoredActiveConversationId(scope = {}) {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return "";
  }

  try {
    return normalizeRecordId(window.sessionStorage.getItem(buildScopeStorageKey(scope)), { fallback: "" });
  } catch {
    return "";
  }
}

function writeStoredActiveConversationId(scope = {}, conversationId) {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return;
  }

  const normalizedConversationId = normalizeRecordId(conversationId, { fallback: null });
  const storageKey = buildScopeStorageKey(scope);
  try {
    if (normalizedConversationId) {
      window.sessionStorage.setItem(storageKey, normalizedConversationId);
      return;
    }

    window.sessionStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

function normalizeConversationStatus(value) {
  return normalizeAssistantConversationStatus(value, {
    fallback: "unknown"
  });
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

function resolveRuntimePolicy() {
  const appConfig = getClientAppConfig();
  const assistantConfig = normalizeObject(appConfig?.assistant);
  const conversationRestorePolicy = resolveConversationRestorePolicy({
    pageSize: assistantConfig.restoreMessagesPageSize,
    maxEntries: assistantConfig.restoreMessagesMaxEntries
  });

  return Object.freeze({
    timeoutMs: toPositiveInteger(assistantConfig.timeoutMs, DEFAULT_STREAM_TIMEOUT_MS),
    historyPageSize: toPositiveInteger(assistantConfig.historyPageSize, DEFAULT_HISTORY_PAGE_SIZE),
    restoreMessagesPageSize: conversationRestorePolicy.pageSize,
    restoreMessagesMaxEntries: conversationRestorePolicy.maxEntries,
    historyStaleTimeMs: toNonNegativeInteger(assistantConfig.historyStaleTimeMs, DEFAULT_HISTORY_STALE_TIME_MS)
  });
}

function createRuntimeApi({ overrideApi = null, resolveBasePath, resolveSurfaceId = null } = {}) {
  if (overrideApi && typeof overrideApi.streamChat === "function") {
    return overrideApi;
  }

  return createAssistantApi({
    request: assistantHttpClient.request,
    requestStream: assistantHttpClient.requestStream,
    resolveBasePath,
    resolveSurfaceId
  });
}

function useAssistantRuntime({ api = null, surfaceId = "" } = {}) {
  const runtimePolicy = resolveRuntimePolicy();
  const queryClient = useQueryClient();
  const errorRuntime = useShellWebErrorRuntime();
  const routeContext = useSurfaceRouteContext();
  const workspaceScopeSupport = useWorkspaceWebScopeSupport();
  const { placementContext, currentSurfaceId } = routeContext;
  const appConfig = getClientAppConfig();

  const messages = ref([]);
  const input = ref("");
  const isStreaming = ref(false);
  const isRestoringConversation = ref(false);
  const error = ref("");
  const pendingToolEvents = ref([]);
  const conversationId = ref(null);
  const abortController = ref(null);

  const placementSnapshot = computed(() => normalizeObject(placementContext.value));
  const assistantSurface = computed(() =>
    resolveAssistantSurfaceConfig(appConfig, surfaceId)
  );
  const routeScope = computed(() => workspaceScopeSupport.readRouteScope(routeContext));
  const runtimeScope = computed(() => {
    const workspaceSlug = assistantSurface.value?.runtimeSurfaceRequiresWorkspace
      ? normalizeText(routeScope.value.workspaceSlug).toLowerCase()
      : "";

    return {
      targetSurfaceId: normalizeText(assistantSurface.value?.targetSurfaceId).toLowerCase(),
      workspaceSlug,
      workspaceId: assistantSurface.value?.runtimeSurfaceRequiresWorkspace
        ? normalizeRecordId(placementSnapshot.value?.workspace?.id, { fallback: null })
        : null
    };
  });
  const hasRuntimeScope = computed(() =>
    Boolean(assistantSurface.value) &&
    (assistantSurface.value?.runtimeSurfaceRequiresWorkspace ? Boolean(runtimeScope.value.workspaceSlug) : true)
  );

  const runtimeApi = createRuntimeApi({
    overrideApi: api,
    resolveBasePath: () =>
      buildAssistantApiPath({
        requiresWorkspace: assistantSurface.value?.runtimeSurfaceRequiresWorkspace === true,
        workspaceSlug: runtimeScope.value.workspaceSlug,
        suffix: `/${runtimeScope.value.targetSurfaceId}`
      }),
    resolveSurfaceId: () => normalizeText(currentSurfaceId.value).toLowerCase()
  });

  const activeConversationId = computed(() => normalizeRecordId(conversationId.value, { fallback: "" }));
  const isAdminSurface = computed(() => normalizeText(currentSurfaceId.value).toLowerCase() === "admin");
  const canSend = computed(() => {
    return Boolean(
      hasRuntimeScope.value &&
        !isStreaming.value &&
        !isRestoringConversation.value &&
        normalizeText(input.value)
    );
  });
  const canStartNewConversation = computed(() => Boolean(hasRuntimeScope.value && !isStreaming.value));

  function setRuntimeError(message, dedupeKey = "") {
    const normalizedMessage = normalizeText(message);
    error.value = normalizedMessage;
    if (!normalizedMessage) {
      return;
    }

    errorRuntime.report({
      source: "assistant.runtime",
      message: normalizedMessage,
      severity: "error",
      channel: "banner",
      dedupeKey: dedupeKey || `assistant.runtime:error:${normalizedMessage}`,
      dedupeWindowMs: 3000
    });
  }

  const conversationHistoryCollection = usePagedCollection({
    queryKey: computed(() =>
      assistantConversationsListQueryKey(runtimeScope.value, {
        limit: runtimePolicy.historyPageSize
      })
    ),
    queryFn: ({ pageParam = null }) =>
      runtimeApi.listConversations({
        cursor: pageParam,
        limit: runtimePolicy.historyPageSize
      }),
    initialPageParam: null,
    dedupeBy(entry) {
      return normalizeRecordId(entry?.id, { fallback: normalizeText(entry?.id) });
    },
    enabled: computed(() => hasRuntimeScope.value),
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
    if (!hasRuntimeScope.value) {
      return;
    }

    const nextConversationIdKey = normalizeRecordId(nextConversationId, { fallback: null });
    if (nextConversationIdKey) {
      writeStoredActiveConversationId(runtimeScope.value, nextConversationIdKey);
      return;
    }

    const previousConversationIdKey = normalizeRecordId(previousConversationId, { fallback: null });
    if (previousConversationIdKey) {
      writeStoredActiveConversationId(runtimeScope.value, "");
    }
  });

  watch(
    [
      hasRuntimeScope,
      conversationHistoryLoading,
      runtimeScope,
      conversationId,
      conversationHistory,
      isRestoringConversation
    ],
    async ([
      nextHasRuntimeScope,
      nextConversationHistoryLoading,
      nextRuntimeScope,
      nextConversationId,
      nextConversationHistory,
      nextIsRestoringConversation
    ]) => {
      if (!nextHasRuntimeScope || nextConversationHistoryLoading || nextIsRestoringConversation) {
        return;
      }

      const activeConversationIdKey = normalizeRecordId(nextConversationId, { fallback: null });
      if (activeConversationIdKey) {
        return;
      }

      const sourceEntries = Array.isArray(nextConversationHistory) ? nextConversationHistory : [];
      if (sourceEntries.length < 1) {
        return;
      }

      const storedConversationId = readStoredActiveConversationId(nextRuntimeScope);
      if (!storedConversationId) {
        return;
      }

      const hasStoredConversation = sourceEntries.some(
        (entry) => normalizeRecordId(entry?.id, { fallback: null }) === storedConversationId
      );
      if (!hasStoredConversation) {
        writeStoredActiveConversationId(nextRuntimeScope, "");
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
    if (!hasRuntimeScope.value) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: assistantScopeQueryKey(runtimeScope.value)
    });
  }

  async function refreshConversationHistory() {
    if (!hasRuntimeScope.value) {
      return;
    }

    await conversationHistoryCollection.reload();
  }

  async function loadMoreConversationHistory() {
    await conversationHistoryCollection.loadMore();
  }

  async function selectConversationById(nextConversationId) {
    const normalizedConversationId = normalizeText(nextConversationId);
    if (!normalizedConversationId || isStreaming.value || isRestoringConversation.value || !hasRuntimeScope.value) {
      return;
    }

    const parsedConversationId = normalizeRecordId(normalizedConversationId, { fallback: null });
    if (!parsedConversationId) {
      return;
    }

    const previousConversationId = conversationId.value;
    conversationId.value = parsedConversationId;
    isRestoringConversation.value = true;
    setRuntimeError("");

    try {
      const transcript = await loadConversationTranscript({
        pageSize: runtimePolicy.restoreMessagesPageSize,
        maxEntries: runtimePolicy.restoreMessagesMaxEntries,
        fetchPage: (page, pageSize) => queryClient.fetchQuery({
          queryKey: assistantConversationMessagesQueryKey(runtimeScope.value, parsedConversationId, {
            page,
            pageSize
          }),
          queryFn: () => runtimeApi.getConversationMessages(parsedConversationId, {
            page,
            pageSize
          }),
          staleTime: runtimePolicy.historyStaleTimeMs
        })
      });

      const restored = mapTranscriptEntriesToAssistantState(transcript.entries);
      messages.value = restored.messages;
      pendingToolEvents.value = restored.pendingToolEvents;
      input.value = "";
    } catch (loadError) {
      conversationId.value = previousConversationId;
      setRuntimeError(normalizeText(loadError?.message) || "Unable to load conversation.");
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
    setRuntimeError("");
    conversationId.value = null;
    writeStoredActiveConversationId(runtimeScope.value, "");
    isStreaming.value = false;
    isRestoringConversation.value = false;
    abortController.value = null;
  }

  function handleInputKeydown(event) {
    if (event?.key === "Enter" && isStreaming.value) {
      event.preventDefault();
      return;
    }

    if (event?.key === "Enter" && event?.altKey === true && event?.ctrlKey !== true && event?.metaKey !== true) {
      event.preventDefault();

      const target = event?.target;
      const nextValue = insertTextAtSelection(input.value, target?.selectionStart, target?.selectionEnd, "\n");
      input.value = nextValue.value;

      void nextTick(() => {
        if (!target || typeof target.setSelectionRange !== "function") {
          return;
        }

        target.setSelectionRange(nextValue.selectionStart, nextValue.selectionEnd);
      });
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
    if (!normalizedInput || isStreaming.value || isRestoringConversation.value || !hasRuntimeScope.value) {
      return;
    }

    const messageId = buildId("message");
    const assistantMessageId = buildId("assistant");
    const history = buildHistory(messages.value);
    const parsedConversationId = normalizeRecordId(conversationId.value, { fallback: null });

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
    setRuntimeError("");
    isStreaming.value = true;

    const streamAbortController = new AbortController();
    abortController.value = streamAbortController;

    const streamTimeout = setTimeout(() => {
      streamAbortController.abort();
    }, runtimePolicy.timeoutMs);

    let streamDoneStatus = "";

    try {
      await runtimeApi.streamChat(
        {
          messageId,
          ...(parsedConversationId ? { conversationId: parsedConversationId } : {}),
          input: normalizedInput,
          history
        },
        {
          signal: streamAbortController.signal,
          onEvent(event) {
            const eventType = normalizeAssistantStreamEventType(event?.type, "");

            if (eventType === ASSISTANT_STREAM_EVENT_TYPES.META && Object.hasOwn(event || {}, "conversationId")) {
              conversationId.value = normalizeRecordId(event?.conversationId, { fallback: null });
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
              setRuntimeError(
                normalizeText(event?.message) || "Assistant request failed.",
                "assistant.runtime:stream-event-error"
              );
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
        if (!error.value) {
          setRuntimeError("Assistant returned no output.", "assistant.runtime:empty-output");
        }
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
        setRuntimeError(normalizeText(streamError?.message) || "Assistant request failed.");
        updateMessage(assistantMessageId, {
          status: "error"
        });
      }
    } finally {
      clearTimeout(streamTimeout);
      pendingToolEvents.value = interruptPendingToolEvents(pendingToolEvents.value);
      abortController.value = null;
      isStreaming.value = false;
      await invalidateConversationScope();
      await refreshConversationHistory();
    }
  }

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

export { useAssistantRuntime };
