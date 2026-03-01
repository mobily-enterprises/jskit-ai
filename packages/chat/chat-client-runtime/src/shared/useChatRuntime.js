import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useInfiniteQuery, useQueryClient } from "@tanstack/vue-query";
import { toPositiveInteger } from "@jskit-ai/runtime-env-core/integers";
import {
  defaultUseAuthGuard,
  createDefaultUseWorkspaceStore,
  createDefaultUseQueryErrorMessage
} from "@jskit-ai/runtime-env-core/clientRuntimeDefaults";
import {
  chatInboxInfiniteQueryKey,
  chatThreadMessagesInfiniteQueryKey,
  mapChatError
} from "@jskit-ai/chat-contracts";

const INBOX_PAGE_SIZE = 20;
const THREAD_MESSAGES_PAGE_SIZE = 50;
const DM_CANDIDATES_PAGE_SIZE = 100;
const WORKSPACE_ROOM_THREAD_KIND = "workspace_room";
const MARK_READ_DEBOUNCE_MS = 180;
const DM_PUBLIC_CHAT_ID_MAX_CHARS = 64;
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;
const TYPING_EMIT_THROTTLE_MS = 1200;
const TYPING_DEFAULT_TTL_MS = 2_000;
const TYPING_PRUNE_INTERVAL_MS = 250;
const DEFAULT_REALTIME_EVENT_TYPES = Object.freeze({
  CHAT_TYPING_STARTED: "chat.typing.started",
  CHAT_TYPING_STOPPED: "chat.typing.stopped"
});
const DEFAULT_SUBSCRIBE_REALTIME_EVENTS = () => () => {};
const DEFAULT_USE_AUTH_GUARD = defaultUseAuthGuard;
const DEFAULT_USE_QUERY_ERROR_MESSAGE = createDefaultUseQueryErrorMessage({
  computed
});
const DEFAULT_USE_WORKSPACE_STORE = createDefaultUseWorkspaceStore({
  activeWorkspaceId: null
});

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

function normalizeAvatarUrl(value) {
  return String(value || "").trim();
}

function isWorkspaceRoomThread(thread) {
  return (
    String(thread?.threadKind || "")
      .trim()
      .toLowerCase() === WORKSPACE_ROOM_THREAD_KIND
  );
}

function parseTimestampMs(value) {
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  if (Number.isNaN(timestamp)) {
    return 0;
  }
  return timestamp;
}

function parseTypingExpiresAtMs(value, nowMs = Date.now()) {
  const parsedMs = parseTimestampMs(value);
  if (parsedMs > 0) {
    return parsedMs;
  }
  return nowMs + TYPING_DEFAULT_TTL_MS;
}

function withinMessageGroupWindow(leftMs, rightMs) {
  if (!leftMs || !rightMs) {
    return false;
  }
  return Math.abs(Number(rightMs) - Number(leftMs)) <= MESSAGE_GROUP_WINDOW_MS;
}

function buildClientMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cm_${crypto.randomUUID()}`;
  }

  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function buildClientAttachmentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `ca_${crypto.randomUUID()}`;
  }

  return `ca_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function buildComposerAttachmentLocalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `local_${crypto.randomUUID()}`;
  }

  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function normalizePublicChatId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, DM_PUBLIC_CHAT_ID_MAX_CHARS);
}

function normalizeDmCandidate(value) {
  const userId = normalizeThreadId(value?.userId);
  const publicChatId = normalizePublicChatId(value?.publicChatId);
  if (!userId || !publicChatId) {
    return null;
  }

  return {
    userId,
    displayName: normalizeText(value?.displayName) || `User #${userId}`,
    avatarUrl: normalizeAvatarUrl(value?.avatarUrl),
    publicChatId,
    sharedWorkspaceCount: Math.max(1, Number(value?.sharedWorkspaceCount || 1))
  };
}

function normalizeFilesArray(filesValue) {
  if (!filesValue) {
    return [];
  }

  if (Array.isArray(filesValue)) {
    return filesValue;
  }

  if (typeof FileList !== "undefined" && filesValue instanceof FileList) {
    return Array.from(filesValue);
  }

  if (typeof filesValue?.length === "number") {
    try {
      return Array.from(filesValue);
    } catch {
      return [];
    }
  }

  return [];
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
  if (threadKind === WORKSPACE_ROOM_THREAD_KIND) {
    return "Workspace chat";
  }

  if (threadKind === "dm") {
    const peerDisplayName = normalizeText(thread?.peerUser?.displayName);
    if (peerDisplayName) {
      return peerDisplayName;
    }

    const peerUserId = normalizeThreadId(thread?.peerUser?.id);
    if (peerUserId) {
      return `User #${peerUserId}`;
    }

    return `Direct message #${normalizeThreadId(thread?.id) || "?"}`;
  }

  return `Thread #${normalizeThreadId(thread?.id) || "?"}`;
}

function formatThreadPreview(thread) {
  if (isWorkspaceRoomThread(thread) && !thread?.lastMessageAt) {
    return "Shared room for everyone in this workspace.";
  }

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

function resolveThreadPeerUser(thread) {
  const threadKind = String(thread?.threadKind || "").toLowerCase();
  if (threadKind !== "dm") {
    return null;
  }

  const userId = normalizeThreadId(thread?.peerUser?.id);
  if (!userId) {
    return null;
  }

  return {
    id: userId,
    displayName: normalizeText(thread?.peerUser?.displayName) || `User #${userId}`,
    avatarUrl: normalizeAvatarUrl(thread?.peerUser?.avatarUrl)
  };
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

function resolveSenderIdentity(
  message,
  { currentUserId = 0, currentUserLabel = "You", currentUserAvatarUrl = "", dmPeerUser = null } = {}
) {
  const senderUserId = normalizeThreadId(message?.senderUserId);
  const normalizedCurrentUserAvatarUrl = normalizeAvatarUrl(currentUserAvatarUrl);
  if (currentUserId > 0 && senderUserId === currentUserId) {
    return {
      label: String(currentUserLabel || "You").trim() || "You",
      avatarUrl: normalizedCurrentUserAvatarUrl
    };
  }

  const dmPeerUserId = normalizeThreadId(dmPeerUser?.id);
  if (dmPeerUserId > 0 && senderUserId === dmPeerUserId) {
    return {
      label: normalizeText(dmPeerUser?.displayName) || `User #${dmPeerUserId}`,
      avatarUrl: normalizeAvatarUrl(dmPeerUser?.avatarUrl)
    };
  }

  return {
    label: formatMessageSender(message),
    avatarUrl: ""
  };
}

function buildMessageRows(
  messages,
  { currentUserId = 0, currentUserLabel = "You", currentUserAvatarUrl = "", dmPeerUser = null } = {}
) {
  const source = Array.isArray(messages) ? messages : [];

  return source.map((message, index) => {
    const currentSenderId = normalizeThreadId(message?.senderUserId);
    const previous = source[index - 1] || null;
    const next = source[index + 1] || null;
    const previousSenderId = normalizeThreadId(previous?.senderUserId);
    const nextSenderId = normalizeThreadId(next?.senderUserId);

    const currentSentMs = parseTimestampMs(message?.sentAt);
    const previousSentMs = parseTimestampMs(previous?.sentAt);
    const nextSentMs = parseTimestampMs(next?.sentAt);

    const groupedWithPrevious =
      Boolean(currentSenderId) &&
      currentSenderId === previousSenderId &&
      withinMessageGroupWindow(previousSentMs, currentSentMs);
    const groupedWithNext =
      Boolean(currentSenderId) &&
      currentSenderId === nextSenderId &&
      withinMessageGroupWindow(currentSentMs, nextSentMs);

    const isMine = currentUserId > 0 && currentSenderId === currentUserId;
    const senderIdentity = resolveSenderIdentity(message, {
      currentUserId,
      currentUserLabel,
      currentUserAvatarUrl,
      dmPeerUser
    });

    return {
      id: Number(message?.id) || `msg_${index}`,
      message,
      isMine,
      senderLabel: senderIdentity.label,
      senderAvatarUrl: senderIdentity.avatarUrl,
      showMeta: !groupedWithPrevious,
      showAvatar: !groupedWithPrevious,
      groupStart: !groupedWithPrevious,
      groupEnd: !groupedWithNext
    };
  });
}

function useChatRuntime({
  api,
  subscribeRealtimeEvents,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore,
  realtimeEventTypes,
  policy
}) {
  const messageMaxChars = Number(policy.messageMaxChars);
  const attachmentMaxFilesPerMessage = Number(policy.attachmentMaxFilesPerMessage);
  const attachmentMaxUploadBytes = Number(policy.attachmentMaxUploadBytes);
  const workspaceStore = useWorkspaceStore();
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();

  const selectedThreadId = ref(0);
  const workspaceRoomThread = ref(null);
  const workspaceRoomPending = ref(false);
  const workspaceRoomError = ref("");
  const composerText = ref("");
  const composerAttachments = ref([]);
  const sendOnEnter = ref(true);
  const sendPending = ref(false);
  const dmPending = ref(false);
  const composerError = ref("");
  const actionError = ref("");
  const dmCandidates = ref([]);
  const dmCandidatesLoading = ref(false);
  const dmCandidatesError = ref("");

  const markReadInFlightThreadId = ref(0);
  const markedReadSeqByThreadId = new Map();
  const typingExpiresByThreadUserKey = new Map();
  const lastTypingEmitAtByThreadId = new Map();
  const attachmentUploadInFlightLocalIds = new Set();
  const typingStateVersion = ref(0);
  let markReadTimer = null;
  let typingPruneTimer = null;
  let unsubscribeRealtimeEvents = null;

  const workspaceSlug = computed(() => String(workspaceStore.activeWorkspaceSlug || "").trim() || "none");
  const currentUserId = computed(() => {
    const parsed = Number(workspaceStore.sessionUserId);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return 0;
    }
    return parsed;
  });
  const currentUserLabel = computed(() => {
    const displayName = String(workspaceStore.profileDisplayName || "").trim();
    return displayName || "You";
  });
  const currentUserAvatarUrl = computed(() => normalizeAvatarUrl(workspaceStore.profileAvatarUrl));
  const enabled = computed(() =>
    Boolean(workspaceStore.initialized && workspaceStore.hasActiveWorkspace && workspaceStore.can("chat.read"))
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
  const selectedThread = computed(() => {
    const normalizedSelectedThreadId = normalizeThreadId(selectedThreadId.value);
    if (!normalizedSelectedThreadId) {
      return null;
    }

    const workspaceThreadId = normalizeThreadId(workspaceRoomThread.value?.id);
    if (workspaceThreadId && workspaceThreadId === normalizedSelectedThreadId) {
      return workspaceRoomThread.value;
    }

    return threads.value.find((entry) => Number(entry?.id) === normalizedSelectedThreadId) || null;
  });
  const inWorkspaceRoom = computed(() => isWorkspaceRoomThread(selectedThread.value));
  const selectedThreadPeerUser = computed(() => resolveThreadPeerUser(selectedThread.value));
  const composerUploadedAttachments = computed(() =>
    (Array.isArray(composerAttachments.value) ? composerAttachments.value : []).filter(
      (attachment) => String(attachment?.status || "") === "uploaded" && normalizeThreadId(attachment?.attachmentId) > 0
    )
  );
  const composerUploadedAttachmentIds = computed(() =>
    composerUploadedAttachments.value.map((attachment) => normalizeThreadId(attachment?.attachmentId)).filter(Boolean)
  );
  const composerHasBlockingAttachments = computed(() =>
    (Array.isArray(composerAttachments.value) ? composerAttachments.value : []).some(
      (attachment) => String(attachment?.status || "") !== "uploaded"
    )
  );
  const composerAttachmentUploadPending = computed(() =>
    (Array.isArray(composerAttachments.value) ? composerAttachments.value : []).some(
      (attachment) => String(attachment?.status || "") === "uploading"
    )
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
  const messageRows = computed(() =>
    buildMessageRows(messages.value, {
      currentUserId: currentUserId.value,
      currentUserLabel: currentUserLabel.value,
      currentUserAvatarUrl: currentUserAvatarUrl.value,
      dmPeerUser: selectedThreadPeerUser.value
    })
  );
  const latestMessage = computed(() => {
    const source = messages.value;
    return source.length > 0 ? source[source.length - 1] : null;
  });
  const typingParticipantLabels = computed(() => {
    void typingStateVersion.value;
    const threadId = normalizeThreadId(selectedThreadId.value);
    if (!threadId) {
      return [];
    }

    const nowMs = Date.now();
    const labels = [];
    for (const [key, expiresAtMs] of typingExpiresByThreadUserKey.entries()) {
      if (Number(expiresAtMs) <= nowMs) {
        continue;
      }

      const [keyThreadIdRaw, keyUserIdRaw] = String(key || "").split(":");
      const keyThreadId = normalizeThreadId(keyThreadIdRaw);
      const keyUserId = normalizeThreadId(keyUserIdRaw);
      if (!keyThreadId || !keyUserId || keyThreadId !== threadId || keyUserId === currentUserId.value) {
        continue;
      }

      if (selectedThreadPeerUser.value && Number(selectedThreadPeerUser.value.id) === keyUserId) {
        labels.push(selectedThreadPeerUser.value.displayName);
        continue;
      }

      labels.push(`User #${keyUserId}`);
    }

    return [...new Set(labels)];
  });
  const typingNotice = computed(() => {
    const labels = typingParticipantLabels.value;
    if (labels.length < 1) {
      return "";
    }
    if (labels.length === 1) {
      return `${labels[0]} is typing...`;
    }
    if (labels.length === 2) {
      return `${labels[0]} and ${labels[1]} are typing...`;
    }
    if (labels.length === 3) {
      return `${labels[0]}, ${labels[1]}, and ${labels[2]} are typing...`;
    }

    const others = labels.length - 2;
    return `${labels[0]}, ${labels[1]}, and ${others} others are typing...`;
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
    markReadTimer = setTimeout(
      () => {
        markReadTimer = null;
        void markActiveThreadRead();
      },
      Math.max(0, Number(delayMs) || MARK_READ_DEBOUNCE_MS)
    );
  }

  function buildThreadUserTypingKey(threadId, userId) {
    return `${Number(threadId)}:${Number(userId)}`;
  }

  function pruneExpiredTypingState(nowMs = Date.now()) {
    let changed = false;
    for (const [key, expiresAtMs] of typingExpiresByThreadUserKey.entries()) {
      if (Number(expiresAtMs) > nowMs) {
        continue;
      }
      typingExpiresByThreadUserKey.delete(key);
      changed = true;
    }

    if (changed) {
      typingStateVersion.value += 1;
    }
  }

  function upsertTypingState(threadId, userId, expiresAtMs) {
    const key = buildThreadUserTypingKey(threadId, userId);
    const previous = Number(typingExpiresByThreadUserKey.get(key) || 0);
    const nextExpiresAtMs = Math.max(Number(expiresAtMs) || 0, previous);
    if (nextExpiresAtMs <= previous) {
      return;
    }

    typingExpiresByThreadUserKey.set(key, nextExpiresAtMs);
    typingStateVersion.value += 1;
  }

  function clearTypingState(threadId, userId) {
    const key = buildThreadUserTypingKey(threadId, userId);
    if (!typingExpiresByThreadUserKey.has(key)) {
      return;
    }

    typingExpiresByThreadUserKey.delete(key);
    typingStateVersion.value += 1;
  }

  function handleRealtimeTypingEvent(event) {
    const eventType = String(event?.eventType || "")
      .trim()
      .toLowerCase();
    const isTypingStarted = eventType === String(realtimeEventTypes.CHAT_TYPING_STARTED || "").toLowerCase();
    const isTypingStopped = eventType === String(realtimeEventTypes.CHAT_TYPING_STOPPED || "").toLowerCase();
    if (!isTypingStarted && !isTypingStopped) {
      return;
    }

    const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
    const threadId = normalizeThreadId(payload.threadId);
    const userId = normalizeThreadId(payload.userId);
    if (!threadId || !userId || userId === currentUserId.value) {
      return;
    }

    if (isTypingStarted) {
      upsertTypingState(threadId, userId, parseTypingExpiresAtMs(payload.expiresAt));
      return;
    }

    clearTypingState(threadId, userId);
  }

  function startTypingPruneLoop() {
    if (typingPruneTimer) {
      return;
    }

    typingPruneTimer = setInterval(() => {
      pruneExpiredTypingState();
    }, TYPING_PRUNE_INTERVAL_MS);
  }

  function stopTypingPruneLoop() {
    if (!typingPruneTimer) {
      return;
    }

    clearInterval(typingPruneTimer);
    typingPruneTimer = null;
  }

  async function emitTypingForActiveThread({ force = false } = {}) {
    if (typeof api?.chat?.emitThreadTyping !== "function") {
      return;
    }

    const threadId = normalizeThreadId(selectedThreadId.value);
    if (!threadId || !enabled.value) {
      return;
    }

    const composerHasContent = normalizeText(composerText.value).length > 0;
    if (!composerHasContent) {
      return;
    }

    const now = Date.now();
    const lastEmittedAt = Number(lastTypingEmitAtByThreadId.get(threadId) || 0);
    if (!force && now - lastEmittedAt < TYPING_EMIT_THROTTLE_MS) {
      return;
    }

    lastTypingEmitAtByThreadId.set(threadId, now);
    try {
      await api.chat.emitThreadTyping(threadId);
    } catch (error) {
      await handleUnauthorizedError(error);
    }
  }

  function findComposerAttachmentIndex(localId) {
    const normalizedLocalId = String(localId || "").trim();
    if (!normalizedLocalId) {
      return -1;
    }

    return (Array.isArray(composerAttachments.value) ? composerAttachments.value : []).findIndex(
      (entry) => String(entry?.localId || "") === normalizedLocalId
    );
  }

  function patchComposerAttachment(localId, patch = {}) {
    const index = findComposerAttachmentIndex(localId);
    if (index < 0) {
      return null;
    }

    const current = composerAttachments.value[index];
    const next = {
      ...current,
      ...(patch && typeof patch === "object" ? patch : {})
    };
    composerAttachments.value.splice(index, 1, next);
    return next;
  }

  function createComposerAttachmentDraft(file) {
    const safeName = normalizeText(file?.name) || "Attachment";
    const mimeType = normalizeText(file?.type) || "application/octet-stream";
    const sizeBytes = Math.max(0, Number(file?.size || 0));

    return {
      localId: buildComposerAttachmentLocalId(),
      clientAttachmentId: buildClientAttachmentId(),
      file,
      fileName: safeName.slice(0, 255),
      mimeType,
      sizeBytes,
      status: "queued",
      attachmentId: 0,
      errorMessage: ""
    };
  }

  async function uploadComposerAttachment(localId) {
    const threadId = normalizeThreadId(selectedThreadId.value);
    if (!threadId) {
      return 0;
    }

    const index = findComposerAttachmentIndex(localId);
    if (index < 0) {
      return 0;
    }

    const attachment = composerAttachments.value[index];
    if (!attachment || attachmentUploadInFlightLocalIds.has(localId)) {
      return normalizeThreadId(attachment?.attachmentId);
    }

    const sizeBytes = Math.max(0, Number(attachment.sizeBytes || 0));
    if (sizeBytes < 1 || sizeBytes > attachmentMaxUploadBytes) {
      patchComposerAttachment(localId, {
        status: "failed",
        errorMessage: `Attachment must be between 1 byte and ${attachmentMaxUploadBytes} bytes.`
      });
      return 0;
    }

    attachmentUploadInFlightLocalIds.add(localId);
    patchComposerAttachment(localId, {
      status: "uploading",
      errorMessage: ""
    });

    try {
      let attachmentId = normalizeThreadId(attachment?.attachmentId);
      if (!attachmentId) {
        const reserveResponse = await api.chat.reserveThreadAttachment(threadId, {
          clientAttachmentId: String(attachment.clientAttachmentId || ""),
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes,
          kind: "file",
          metadata: {}
        });
        attachmentId = normalizeThreadId(reserveResponse?.attachment?.id);
      }

      if (!attachmentId) {
        throw new Error("Attachment reservation did not return a valid id.");
      }

      const formData = new FormData();
      formData.append("attachmentId", String(attachmentId));
      formData.append("file", attachment.file, attachment.fileName);
      const uploadResponse = await api.chat.uploadThreadAttachment(threadId, formData);
      const uploadedAttachmentId = normalizeThreadId(uploadResponse?.attachment?.id) || attachmentId;

      patchComposerAttachment(localId, {
        status: "uploaded",
        attachmentId: uploadedAttachmentId,
        errorMessage: ""
      });

      return uploadedAttachmentId;
    } catch (error) {
      const handled = await handleUnauthorizedError(error);
      if (handled) {
        return 0;
      }

      patchComposerAttachment(localId, {
        status: "failed",
        errorMessage: mapChatError(error, "Attachment upload failed.").message
      });
      return 0;
    } finally {
      attachmentUploadInFlightLocalIds.delete(localId);
    }
  }

  async function addComposerFiles(filesValue) {
    const threadId = normalizeThreadId(selectedThreadId.value);
    if (!threadId) {
      composerError.value = "Select a thread before adding attachments.";
      return 0;
    }

    const incomingFiles = normalizeFilesArray(filesValue).filter((entry) => entry && typeof entry === "object");
    if (incomingFiles.length < 1) {
      return 0;
    }

    composerError.value = "";

    const availableSlots = Math.max(0, attachmentMaxFilesPerMessage - composerAttachments.value.length);
    if (availableSlots < 1) {
      composerError.value = `You can add up to ${attachmentMaxFilesPerMessage} attachments per message.`;
      return 0;
    }

    const acceptedFiles = incomingFiles.slice(0, availableSlots);
    if (acceptedFiles.length < incomingFiles.length) {
      composerError.value = `Only ${attachmentMaxFilesPerMessage} attachments are allowed per message.`;
    }

    const drafts = [];
    for (const file of acceptedFiles) {
      const sizeBytes = Math.max(0, Number(file?.size || 0));
      if (sizeBytes < 1 || sizeBytes > attachmentMaxUploadBytes) {
        composerError.value = `Each attachment must be between 1 byte and ${attachmentMaxUploadBytes} bytes.`;
        continue;
      }
      drafts.push(createComposerAttachmentDraft(file));
    }

    if (drafts.length < 1) {
      return 0;
    }

    composerAttachments.value = [...composerAttachments.value, ...drafts];
    await Promise.all(drafts.map((draft) => uploadComposerAttachment(draft.localId)));
    return drafts.length;
  }

  async function retryComposerAttachment(localId) {
    const index = findComposerAttachmentIndex(localId);
    if (index < 0) {
      return 0;
    }

    return uploadComposerAttachment(localId);
  }

  async function removeComposerAttachment(localId) {
    const index = findComposerAttachmentIndex(localId);
    if (index < 0) {
      return false;
    }

    const threadId = normalizeThreadId(selectedThreadId.value);
    const attachment = composerAttachments.value[index];
    if (attachmentUploadInFlightLocalIds.has(localId)) {
      return false;
    }

    const attachmentId = normalizeThreadId(attachment?.attachmentId);
    composerAttachments.value.splice(index, 1);

    if (!threadId || !attachmentId) {
      return true;
    }

    try {
      await api.chat.deleteThreadAttachment(threadId, attachmentId);
    } catch (error) {
      await handleUnauthorizedError(error);
    }

    return true;
  }

  function clearComposerAttachments() {
    composerAttachments.value = [];
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

  async function ensureWorkspaceRoom({ force = false, selectRoom = true } = {}) {
    if (!enabled.value) {
      workspaceRoomThread.value = null;
      workspaceRoomError.value = "";
      return 0;
    }

    if (typeof api?.chat?.ensureWorkspaceRoom !== "function") {
      workspaceRoomError.value = "Workspace chat is unavailable.";
      return 0;
    }

    if (workspaceRoomPending.value) {
      return normalizeThreadId(workspaceRoomThread.value?.id);
    }

    const existingThreadId = normalizeThreadId(workspaceRoomThread.value?.id);
    if (!force && existingThreadId > 0) {
      if (selectRoom && !normalizeThreadId(selectedThreadId.value)) {
        selectedThreadId.value = existingThreadId;
      }
      return existingThreadId;
    }

    workspaceRoomPending.value = true;
    workspaceRoomError.value = "";
    actionError.value = "";

    try {
      const response = await api.chat.ensureWorkspaceRoom({});
      const thread = response?.thread && typeof response.thread === "object" ? response.thread : null;
      const threadId = normalizeThreadId(thread?.id);
      if (!threadId) {
        throw new Error("Workspace chat ensure response did not include a valid thread id.");
      }

      workspaceRoomThread.value = thread;
      if (selectRoom || !normalizeThreadId(selectedThreadId.value)) {
        await selectThread(threadId);
      }

      return threadId;
    } catch (error) {
      const handled = await handleUnauthorizedError(error);
      if (handled) {
        return 0;
      }

      const mapped = mapChatError(error, "Unable to open workspace chat.");
      workspaceRoomError.value = mapped.message;
      actionError.value = mapped.message;
      if (selectRoom) {
        selectedThreadId.value = 0;
      }
      return 0;
    } finally {
      workspaceRoomPending.value = false;
    }
  }

  async function backToWorkspaceRoom() {
    const workspaceThreadId = normalizeThreadId(workspaceRoomThread.value?.id);
    if (workspaceThreadId > 0) {
      await selectThread(workspaceThreadId);
      return workspaceThreadId;
    }

    return ensureWorkspaceRoom({
      force: true,
      selectRoom: true
    });
  }

  async function selectThread(threadId) {
    const normalizedThreadId = normalizeThreadId(threadId);
    if (!normalizedThreadId || normalizedThreadId === selectedThreadId.value) {
      return;
    }

    selectedThreadId.value = normalizedThreadId;
    actionError.value = "";
    composerError.value = "";
    composerText.value = "";
    clearComposerAttachments();
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
    const attachmentIds = composerUploadedAttachmentIds.value;

    if (trimmed.length > messageMaxChars) {
      composerError.value = `Message must be ${messageMaxChars} characters or fewer.`;
      return;
    }

    if (composerHasBlockingAttachments.value) {
      composerError.value = "Resolve attachment uploads before sending.";
      return;
    }

    const hasText = trimmed.length > 0;
    const hasAttachments = attachmentIds.length > 0;
    if (!hasText && !hasAttachments) {
      return;
    }

    sendPending.value = true;
    composerError.value = "";

    try {
      const payload = {
        clientMessageId: buildClientMessageId(),
        text: hasText ? trimmed : undefined,
        attachmentIds: hasAttachments ? attachmentIds : undefined
      };
      await api.chat.sendThreadMessage(threadId, payload);
      composerText.value = "";
      clearComposerAttachments();
      composerError.value = "";

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
      composerError.value = mapped.message;
    } finally {
      sendPending.value = false;
    }
  }

  function handleComposerKeydown(event) {
    if (!sendOnEnter.value) {
      return;
    }

    if (String(event?.key || "") !== "Enter") {
      return;
    }

    if (event?.shiftKey || event?.ctrlKey || event?.metaKey || event?.altKey) {
      return;
    }

    const hasText =
      normalizeText(composerText.value).length > 0 &&
      normalizeText(composerText.value).length <= messageMaxChars;
    const hasUploadedAttachments = composerUploadedAttachmentIds.value.length > 0;
    if (
      !(
        selectedThreadId.value > 0 &&
        !sendPending.value &&
        !composerHasBlockingAttachments.value &&
        (hasText || hasUploadedAttachments)
      )
    ) {
      return;
    }

    if (typeof event?.preventDefault === "function") {
      event.preventDefault();
    }
    void sendFromComposer();
  }

  async function ensureDmThread(targetPublicChatId) {
    const normalizedTargetPublicChatId = normalizePublicChatId(targetPublicChatId);
    if (!normalizedTargetPublicChatId) {
      actionError.value = "Enter a public chat id to start a DM.";
      return 0;
    }

    dmPending.value = true;
    actionError.value = "";

    try {
      const result = await api.chat.ensureDm({
        targetPublicChatId: normalizedTargetPublicChatId
      });
      const threadId = normalizeThreadId(result?.thread?.id);
      if (!threadId) {
        throw new Error("DM response did not include a valid thread.");
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: inboxQueryKey.value
        }),
        inboxQuery.refetch()
      ]);

      await selectThread(threadId);
      return threadId;
    } catch (error) {
      const handled = await handleUnauthorizedError(error);
      if (handled) {
        return 0;
      }
      actionError.value = mapChatError(error, "Unable to start direct message.").message;
      return 0;
    } finally {
      dmPending.value = false;
    }
  }

  async function refreshDmCandidates({ search = "", limit = DM_CANDIDATES_PAGE_SIZE } = {}) {
    if (typeof api?.chat?.listDmCandidates !== "function") {
      dmCandidates.value = [];
      dmCandidatesError.value = "Direct-message candidates are unavailable.";
      return [];
    }

    dmCandidatesLoading.value = true;
    dmCandidatesError.value = "";

    try {
      const result = await api.chat.listDmCandidates({
        q: normalizeText(search) || undefined,
        limit
      });

      const items = Array.isArray(result?.items) ? result.items : [];
      dmCandidates.value = items.map((entry) => normalizeDmCandidate(entry)).filter(Boolean);
    } catch (error) {
      const handled = await handleUnauthorizedError(error);
      if (handled) {
        return [];
      }

      dmCandidatesError.value = mapChatError(error, "Unable to load direct-message candidates.").message;
      dmCandidates.value = [];
    } finally {
      dmCandidatesLoading.value = false;
    }

    return dmCandidates.value;
  }

  watch(
    () => [enabled.value, workspaceSlug.value],
    ([nextEnabled, nextWorkspaceSlug], previous = []) => {
      const previousEnabled = Boolean(previous[0]);
      const previousWorkspaceSlug = String(previous[1] || "");
      const workspaceChanged =
        Boolean(previousWorkspaceSlug) && previousWorkspaceSlug !== String(nextWorkspaceSlug || "");

      if (!nextEnabled) {
        selectedThreadId.value = 0;
        workspaceRoomThread.value = null;
        workspaceRoomError.value = "";
        workspaceRoomPending.value = false;
        return;
      }

      if (workspaceChanged) {
        selectedThreadId.value = 0;
        workspaceRoomThread.value = null;
        workspaceRoomError.value = "";
      }

      const hasWorkspaceThread = normalizeThreadId(workspaceRoomThread.value?.id) > 0;
      if (!previousEnabled || workspaceChanged || !hasWorkspaceThread) {
        void ensureWorkspaceRoom({
          force: workspaceChanged || !hasWorkspaceThread,
          selectRoom: true
        });
      }
    },
    {
      immediate: true
    }
  );

  watch(
    () => [threads.value, workspaceRoomThread.value, selectedThreadId.value],
    ([nextThreads, nextWorkspaceRoomThread, nextSelectedThreadId]) => {
      const selected = normalizeThreadId(nextSelectedThreadId);
      const workspaceThreadId = normalizeThreadId(nextWorkspaceRoomThread?.id);
      const threadItems = Array.isArray(nextThreads) ? nextThreads : [];

      if (!selected) {
        if (workspaceThreadId) {
          selectedThreadId.value = workspaceThreadId;
        }
        return;
      }

      if (workspaceThreadId && selected === workspaceThreadId) {
        return;
      }

      const selectedExists = threadItems.some((thread) => normalizeThreadId(thread?.id) === selected);
      if (selectedExists) {
        return;
      }

      selectedThreadId.value = workspaceThreadId || 0;
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

  watch(
    () => [selectedThreadId.value, composerText.value],
    ([nextThreadId, nextText], previous = []) => {
      const previousThreadId = Number(previous[0] || 0);
      if (!nextThreadId || !normalizeText(nextText)) {
        return;
      }

      const force = Number(nextThreadId) !== previousThreadId;
      void emitTypingForActiveThread({
        force
      });
    }
  );

  unsubscribeRealtimeEvents = subscribeRealtimeEvents((eventEnvelope) => {
    handleRealtimeTypingEvent(eventEnvelope);
  });
  startTypingPruneLoop();

  onBeforeUnmount(() => {
    clearMarkReadTimer();
    stopTypingPruneLoop();
    if (typeof unsubscribeRealtimeEvents === "function") {
      unsubscribeRealtimeEvents();
      unsubscribeRealtimeEvents = null;
    }
    clearComposerAttachments();
  });

  return {
    meta: {
      inboxPageSize: INBOX_PAGE_SIZE,
      messagePageSize: THREAD_MESSAGES_PAGE_SIZE,
      dmCandidatesPageSize: DM_CANDIDATES_PAGE_SIZE,
      messageMaxChars,
      attachmentMaxFilesPerMessage,
      attachmentMaxUploadBytes
    },
    state: reactive({
      enabled,
      selectedThreadId,
      selectedThread,
      selectedThreadPeerUser,
      workspaceRoomThread,
      workspaceRoomPending,
      workspaceRoomError,
      inWorkspaceRoom,
      threads,
      messages,
      latestMessage,
      messageRows,
      currentUserAvatarUrl,
      typingNotice,
      composerText,
      composerAttachments,
      sendOnEnter,
      sendPending,
      dmPending,
      dmCandidates,
      dmCandidatesLoading,
      dmCandidatesError,
      composerError,
      actionError,
      inboxError,
      messagesError,
      inboxLoading: computed(() => Boolean(inboxQuery.isPending.value || inboxQuery.isFetching.value)),
      messagesLoading: computed(() =>
        Boolean(threadMessagesQuery.isPending.value || threadMessagesQuery.isFetching.value)
      ),
      hasMoreThreads: computed(() => Boolean(inboxQuery.hasNextPage.value)),
      hasMoreMessages: computed(() => Boolean(threadMessagesQuery.hasNextPage.value)),
      loadingMoreThreads: computed(() => Boolean(inboxQuery.isFetchingNextPage.value)),
      loadingMoreMessages: computed(() => Boolean(threadMessagesQuery.isFetchingNextPage.value)),
      attachmentUploadPending: composerAttachmentUploadPending,
      canSend: computed(() =>
        Boolean(
          selectedThreadId.value > 0 &&
          !sendPending.value &&
          !composerHasBlockingAttachments.value &&
          ((normalizeText(composerText.value).length > 0 &&
            normalizeText(composerText.value).length <= messageMaxChars) ||
            composerUploadedAttachmentIds.value.length > 0)
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
      ensureWorkspaceRoom,
      backToWorkspaceRoom,
      selectThread,
      ensureDmThread,
      refreshDmCandidates,
      refreshInbox,
      refreshThread,
      loadMoreThreads,
      loadOlderMessages,
      sendFromComposer,
      handleComposerKeydown,
      addComposerFiles,
      retryComposerAttachment,
      removeComposerAttachment
    }
  };
}

const chatRuntimeTestables = {
  INBOX_PAGE_SIZE,
  THREAD_MESSAGES_PAGE_SIZE,
  DM_CANDIDATES_PAGE_SIZE,
  normalizeThreadId,
  normalizePublicChatId,
  flattenThreadPages,
  flattenMessagePagesChronologically,
  buildMessageRows,
  resolveChatRuntimePolicy
};

function resolveChatRuntimeDependencies(deps = {}) {
  const source = deps && typeof deps === "object" ? deps : {};

  return {
    api: source.api && typeof source.api === "object" ? source.api : null,
    subscribeRealtimeEvents:
      typeof source.subscribeRealtimeEvents === "function"
        ? source.subscribeRealtimeEvents
        : DEFAULT_SUBSCRIBE_REALTIME_EVENTS,
    useAuthGuard: typeof source.useAuthGuard === "function" ? source.useAuthGuard : DEFAULT_USE_AUTH_GUARD,
    useQueryErrorMessage:
      typeof source.useQueryErrorMessage === "function"
        ? source.useQueryErrorMessage
        : DEFAULT_USE_QUERY_ERROR_MESSAGE,
    useWorkspaceStore:
      typeof source.useWorkspaceStore === "function" ? source.useWorkspaceStore : DEFAULT_USE_WORKSPACE_STORE,
    realtimeEventTypes:
      source.realtimeEventTypes && typeof source.realtimeEventTypes === "object"
        ? source.realtimeEventTypes
        : DEFAULT_REALTIME_EVENT_TYPES
  };
}

function assertChatRuntimeDependencies({ api }) {
  const requiredMethods = [
    "ensureDm",
    "listInbox",
    "listThreadMessages",
    "sendThreadMessage",
    "markThreadRead",
    "reserveThreadAttachment",
    "uploadThreadAttachment",
    "deleteThreadAttachment"
  ];
  const missingMethods = requiredMethods.filter((methodName) => typeof api?.chat?.[methodName] !== "function");
  if (missingMethods.length > 0) {
    throw new Error(`chat-client-runtime missing required api.chat methods: ${missingMethods.join(", ")}`);
  }
}

function resolveChatRuntimePolicy(policy) {
  const source = policy && typeof policy === "object" ? policy : null;
  if (!source) {
    throw new Error("chat-client-runtime missing required policy object.");
  }

  const normalized = {
    messageMaxChars: toPositiveInteger(source.messageMaxChars),
    attachmentMaxFilesPerMessage: toPositiveInteger(source.attachmentMaxFilesPerMessage),
    attachmentMaxUploadBytes: toPositiveInteger(source.attachmentMaxUploadBytes)
  };

  const invalidFields = Object.entries(normalized)
    .filter(([, value]) => value < 1)
    .map(([key]) => key);
  if (invalidFields.length > 0) {
    throw new Error(`chat-client-runtime policy fields must be positive integers: ${invalidFields.join(", ")}`);
  }

  return Object.freeze(normalized);
}

function createChatRuntime(deps = {}) {
  const runtimeDeps = resolveChatRuntimeDependencies(deps);
  const runtimePolicy = resolveChatRuntimePolicy(deps?.policy);
  assertChatRuntimeDependencies(runtimeDeps);
  const runtimeOptions = {
    ...runtimeDeps,
    policy: runtimePolicy
  };

  function useBoundChatRuntime() {
    return useChatRuntime(runtimeOptions);
  }

  return {
    useChatRuntime: useBoundChatRuntime,
    useChatView: useBoundChatRuntime,
    chatRuntimeTestables
  };
}

export { createChatRuntime, chatRuntimeTestables };
