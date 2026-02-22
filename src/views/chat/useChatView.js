import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useInfiniteQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import { mapChatError } from "../../features/chat/errors.js";
import {
  chatInboxInfiniteQueryKey,
  chatThreadMessagesInfiniteQueryKey
} from "../../features/chat/queryKeys.js";

const INBOX_PAGE_SIZE = 20;
const THREAD_MESSAGES_PAGE_SIZE = 50;
const CHAT_MESSAGE_MAX_TEXT_CHARS = 4000;
const MARK_READ_DEBOUNCE_MS = 180;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeThreadId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function buildClientMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cm_${crypto.randomUUID()}`;
  }

  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function flattenThreadPages(pages) {
  const source = Array.isArray(pages) ? pages : [];
  const items = [];
  const seenThreadIds = new Set();
  for (const page of source) {
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    for (const item of pageItems) {
      const threadId = normalizeThreadId(item?.id);
      if (!threadId || seenThreadIds.has(threadId)) {
        continue;
      }
      seenThreadIds.add(threadId);
      items.push(item);
    }
  }

  return items;
}

function flattenMessagePagesChronologically(pages) {
  const source = Array.isArray(pages) ? [...pages].reverse() : [];
  const items = [];
  const seenMessageIds = new Set();
  for (const page of source) {
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    for (const item of pageItems) {
      const messageId = normalizeThreadId(item?.id);
      if (!messageId || seenMessageIds.has(messageId)) {
        continue;
      }
      seenMessageIds.add(messageId);
      items.push(item);
    }
  }

  return items;
}

function formatTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleString();
}

function formatThreadTitle(thread) {
  const title = normalizeText(thread?.title);
  if (title) {
    return title;
  }

  const threadKind = String(thread?.threadKind || "").toLowerCase();
  if (threadKind === "dm") {
    return `Direct message #${normalizeThreadId(thread?.id) || "?"}`;
  }

  return `Thread #${normalizeThreadId(thread?.id) || "?"}`;
}

function formatThreadPreview(thread) {
  const preview = normalizeText(thread?.lastMessagePreview);
  if (preview) {
    return preview;
  }

  if (thread?.lastMessageAt) {
    return "No preview available.";
  }

  return "No messages yet.";
}

function formatMessageSender(message) {
  const senderUserId = normalizeThreadId(message?.senderUserId);
  return senderUserId ? `User #${senderUserId}` : "Unknown sender";
}

function formatMessageText(message) {
  const text = String(message?.text || "");
  if (normalizeText(text)) {
    return text;
  }

  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (attachments.length > 0) {
    const suffix = attachments.length === 1 ? "" : "s";
    return `[${attachments.length} attachment${suffix}]`;
  }

  return "(No content)";
}

export function useChatView() {
  const workspaceStore = useWorkspaceStore();
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();

  const selectedThreadId = ref(0);
  const composerText = ref("");
  const sendPending = ref(false);
  const sendStatus = ref("");
  const actionError = ref("");

  const markReadInFlightThreadId = ref(0);
  const markedReadSeqByThreadId = new Map();
  let markReadTimer = null;

  const workspaceSlug = computed(() => String(workspaceStore.activeWorkspaceSlug || "").trim() || "none");
  const enabled = computed(
    () => Boolean(workspaceStore.initialized && workspaceStore.hasActiveWorkspace && workspaceStore.can("chat.read"))
  );

  const inboxQueryKey = computed(() => chatInboxInfiniteQueryKey(workspaceSlug.value, { limit: INBOX_PAGE_SIZE }));

  const inboxQuery = useInfiniteQuery({
    queryKey: inboxQueryKey,
    queryFn: ({ pageParam }) =>
      api.chat.listInbox({
        cursor: pageParam || undefined,
        limit: INBOX_PAGE_SIZE
      }),
    enabled,
    initialPageParam: null,
    getNextPageParam: (lastPage) => {
      const cursor = String(lastPage?.nextCursor || "").trim();
      return cursor || undefined;
    },
    placeholderData: (previous) => previous
  });

  const threads = computed(() => flattenThreadPages(inboxQuery.data.value?.pages));
  const selectedThread = computed(() =>
    threads.value.find((entry) => Number(entry?.id) === Number(selectedThreadId.value)) || null
  );

  const messagesQueryKey = computed(() =>
    chatThreadMessagesInfiniteQueryKey(workspaceSlug.value, selectedThreadId.value, {
      limit: THREAD_MESSAGES_PAGE_SIZE
    })
  );

  const threadMessagesQuery = useInfiniteQuery({
    queryKey: messagesQueryKey,
    queryFn: ({ pageParam }) =>
      api.chat.listThreadMessages(selectedThreadId.value, {
        cursor: pageParam || undefined,
        limit: THREAD_MESSAGES_PAGE_SIZE
      }),
    enabled: computed(() => enabled.value && selectedThreadId.value > 0),
    initialPageParam: null,
    getNextPageParam: (lastPage) => {
      const cursor = String(lastPage?.nextCursor || "").trim();
      return cursor || undefined;
    },
    placeholderData: (previous) => previous
  });

  const messages = computed(() => flattenMessagePagesChronologically(threadMessagesQuery.data.value?.pages));
  const latestMessage = computed(() => {
    const source = messages.value;
    return source.length > 0 ? source[source.length - 1] : null;
  });

  const inboxError = useQueryErrorMessage({
    query: inboxQuery,
    handleUnauthorizedError,
    mapError: (error) => mapChatError(error, "Unable to load inbox.")
  });
  const messagesError = useQueryErrorMessage({
    query: threadMessagesQuery,
    handleUnauthorizedError,
    mapError: (error) => mapChatError(error, "Unable to load messages.")
  });

  function clearMarkReadTimer() {
    if (!markReadTimer) {
      return;
    }

    clearTimeout(markReadTimer);
    markReadTimer = null;
  }

  function scheduleMarkRead(delayMs = MARK_READ_DEBOUNCE_MS) {
    clearMarkReadTimer();
    markReadTimer = setTimeout(() => {
      markReadTimer = null;
      void markActiveThreadRead();
    }, Math.max(0, Number(delayMs) || MARK_READ_DEBOUNCE_MS));
  }

  async function markActiveThreadRead() {
    const thread = selectedThread.value;
    const message = latestMessage.value;
    const threadId = normalizeThreadId(thread?.id);
    const latestSeq = Number(message?.threadSeq || 0);
    if (!threadId || latestSeq < 1) {
      return;
    }

    const participantReadSeq = Number(thread?.participant?.lastReadSeq || 0);
    const localReadSeq = Number(markedReadSeqByThreadId.get(threadId) || 0);
    const knownReadSeq = Math.max(participantReadSeq, localReadSeq);
    if (latestSeq <= knownReadSeq || markReadInFlightThreadId.value === threadId) {
      return;
    }

    markReadInFlightThreadId.value = threadId;
    try {
      const response = await api.chat.markThreadRead(threadId, {
        threadSeq: latestSeq
      });
      markedReadSeqByThreadId.set(threadId, Number(response?.lastReadSeq || latestSeq));
      await queryClient.invalidateQueries({
        queryKey: inboxQueryKey.value
      });
    } catch (error) {
      await handleUnauthorizedError(error);
    } finally {
      markReadInFlightThreadId.value = 0;
    }
  }

  async function selectThread(threadId) {
    const normalizedThreadId = normalizeThreadId(threadId);
    if (!normalizedThreadId || normalizedThreadId === selectedThreadId.value) {
      return;
    }

    selectedThreadId.value = normalizedThreadId;
    actionError.value = "";
    sendStatus.value = "";
    composerText.value = "";
  }

  async function refreshInbox() {
    actionError.value = "";
    try {
      await inboxQuery.refetch();
    } catch (error) {
      const handled = await handleUnauthorizedError(error);
      if (handled) {
        return;
      }
      actionError.value = mapChatError(error, "Unable to refresh inbox.").message;
    }
  }

  async function refreshThread() {
    actionError.value = "";
    if (!selectedThreadId.value) {
      return;
    }

    try {
      await threadMessagesQuery.refetch();
      scheduleMarkRead(60);
    } catch (error) {
      const handled = await handleUnauthorizedError(error);
      if (handled) {
        return;
      }
      actionError.value = mapChatError(error, "Unable to refresh thread.").message;
    }
  }

  async function loadMoreThreads() {
    if (!inboxQuery.hasNextPage.value || inboxQuery.isFetchingNextPage.value) {
      return;
    }

    actionError.value = "";
    try {
      await inboxQuery.fetchNextPage();
    } catch (error) {
      const handled = await handleUnauthorizedError(error);
      if (handled) {
        return;
      }
      actionError.value = mapChatError(error, "Unable to load more threads.").message;
    }
  }

  async function loadOlderMessages() {
    if (!threadMessagesQuery.hasNextPage.value || threadMessagesQuery.isFetchingNextPage.value) {
      return;
    }

    actionError.value = "";
    try {
      await threadMessagesQuery.fetchNextPage();
    } catch (error) {
      const handled = await handleUnauthorizedError(error);
      if (handled) {
        return;
      }
      actionError.value = mapChatError(error, "Unable to load older messages.").message;
    }
  }

  async function sendFromComposer() {
    const threadId = normalizeThreadId(selectedThreadId.value);
    if (!threadId || sendPending.value) {
      return;
    }

    const text = String(composerText.value || "");
    const trimmed = normalizeText(text);
    if (!trimmed) {
      return;
    }

    if (trimmed.length > CHAT_MESSAGE_MAX_TEXT_CHARS) {
      actionError.value = `Message must be ${CHAT_MESSAGE_MAX_TEXT_CHARS} characters or fewer.`;
      return;
    }

    sendPending.value = true;
    actionError.value = "";
    sendStatus.value = "";

    try {
      const result = await api.chat.sendThreadMessage(threadId, {
        clientMessageId: buildClientMessageId(),
        text: trimmed
      });
      composerText.value = "";
      sendStatus.value =
        String(result?.idempotencyStatus || "") === "replayed"
          ? "Request replayed. Existing message returned."
          : "Message sent.";

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: messagesQueryKey.value
        }),
        queryClient.invalidateQueries({
          queryKey: inboxQueryKey.value
        })
      ]);

      scheduleMarkRead(50);
    } catch (error) {
      const handled = await handleUnauthorizedError(error);
      if (handled) {
        return;
      }
      const mapped = mapChatError(error, "Unable to send message.");
      actionError.value = mapped.message;
    } finally {
      sendPending.value = false;
    }
  }

  watch(
    threads,
    (nextThreads) => {
      if (!Array.isArray(nextThreads) || nextThreads.length < 1) {
        selectedThreadId.value = 0;
        return;
      }

      const selected = normalizeThreadId(selectedThreadId.value);
      const selectedStillExists = nextThreads.some((thread) => Number(thread?.id) === selected);
      if (selectedStillExists) {
        return;
      }

      selectedThreadId.value = normalizeThreadId(nextThreads[0]?.id);
    },
    {
      immediate: true
    }
  );

  watch(
    () => [
      selectedThreadId.value,
      Number(latestMessage.value?.threadSeq || 0),
      Number(selectedThread.value?.participant?.lastReadSeq || 0)
    ],
    ([threadId, latestSeq, lastReadSeq]) => {
      if (!threadId || latestSeq < 1 || latestSeq <= lastReadSeq) {
        return;
      }

      scheduleMarkRead();
    },
    {
      immediate: true
    }
  );

  onBeforeUnmount(() => {
    clearMarkReadTimer();
  });

  return {
    meta: {
      inboxPageSize: INBOX_PAGE_SIZE,
      messagePageSize: THREAD_MESSAGES_PAGE_SIZE,
      messageMaxChars: CHAT_MESSAGE_MAX_TEXT_CHARS
    },
    state: reactive({
      enabled,
      selectedThreadId,
      selectedThread,
      threads,
      messages,
      latestMessage,
      composerText,
      sendPending,
      sendStatus,
      actionError,
      inboxError,
      messagesError,
      inboxLoading: computed(() => Boolean(inboxQuery.isPending.value || inboxQuery.isFetching.value)),
      messagesLoading: computed(() => Boolean(threadMessagesQuery.isPending.value || threadMessagesQuery.isFetching.value)),
      hasMoreThreads: computed(() => Boolean(inboxQuery.hasNextPage.value)),
      hasMoreMessages: computed(() => Boolean(threadMessagesQuery.hasNextPage.value)),
      loadingMoreThreads: computed(() => Boolean(inboxQuery.isFetchingNextPage.value)),
      loadingMoreMessages: computed(() => Boolean(threadMessagesQuery.isFetchingNextPage.value)),
      canSend: computed(
        () =>
          Boolean(
            selectedThreadId.value > 0 &&
              !sendPending.value &&
              normalizeText(composerText.value).length > 0 &&
              normalizeText(composerText.value).length <= CHAT_MESSAGE_MAX_TEXT_CHARS
          )
      )
    }),
    helpers: {
      formatTimestamp,
      formatThreadTitle,
      formatThreadPreview,
      formatMessageSender,
      formatMessageText
    },
    actions: {
      selectThread,
      refreshInbox,
      refreshThread,
      loadMoreThreads,
      loadOlderMessages,
      sendFromComposer
    }
  };
}

