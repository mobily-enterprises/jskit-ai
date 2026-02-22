import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useInfiniteQuery, useQueryClient } from "@tanstack/vue-query";
import { REALTIME_EVENT_TYPES } from "../../../shared/realtime/eventTypes.js";
import { api } from "../../services/api/index.js";
import { subscribeRealtimeEvents } from "../../services/realtime/realtimeEventBus.js";
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
const CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE = 5;
const CHAT_ATTACHMENT_MAX_UPLOAD_BYTES = 20_000_000;
const MARK_READ_DEBOUNCE_MS = 180;
const DM_PUBLIC_CHAT_ID_MAX_CHARS = 64;
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;
const TYPING_EMIT_THROTTLE_MS = 1200;
const TYPING_DEFAULT_TTL_MS = 2_000;
const TYPING_PRUNE_INTERVAL_MS = 250;

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
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, DM_PUBLIC_CHAT_ID_MAX_CHARS);
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
  {
    currentUserId = 0,
    currentUserLabel = "You",
    currentUserAvatarUrl = "",
    dmPeerUser = null
  } = {}
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

export function useChatView() {
  const workspaceStore = useWorkspaceStore();
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();

  const selectedThreadId = ref(0);
  const composerText = ref("");
  const composerAttachments = ref([]);
  const sendOnEnter = ref(true);
  const sendPending = ref(false);
  const dmPending = ref(false);
  const sendStatus = ref("");
  const actionError = ref("");

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
    markReadTimer = setTimeout(() => {
      markReadTimer = null;
      void markActiveThreadRead();
    }, Math.max(0, Number(delayMs) || MARK_READ_DEBOUNCE_MS));
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
    const eventType = String(event?.eventType || "").trim().toLowerCase();
    const isTypingStarted = eventType === String(REALTIME_EVENT_TYPES.CHAT_TYPING_STARTED || "").toLowerCase();
    const isTypingStopped = eventType === String(REALTIME_EVENT_TYPES.CHAT_TYPING_STOPPED || "").toLowerCase();
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
    if (sizeBytes < 1 || sizeBytes > CHAT_ATTACHMENT_MAX_UPLOAD_BYTES) {
      patchComposerAttachment(localId, {
        status: "failed",
        errorMessage: `Attachment must be between 1 byte and ${CHAT_ATTACHMENT_MAX_UPLOAD_BYTES} bytes.`
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
      actionError.value = "Select a thread before adding attachments.";
      return 0;
    }

    const incomingFiles = normalizeFilesArray(filesValue).filter((entry) => entry && typeof entry === "object");
    if (incomingFiles.length < 1) {
      return 0;
    }

    actionError.value = "";
    sendStatus.value = "";

    const availableSlots = Math.max(0, CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE - composerAttachments.value.length);
    if (availableSlots < 1) {
      actionError.value = `You can add up to ${CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE} attachments per message.`;
      return 0;
    }

    const acceptedFiles = incomingFiles.slice(0, availableSlots);
    if (acceptedFiles.length < incomingFiles.length) {
      actionError.value = `Only ${CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE} attachments are allowed per message.`;
    }

    const drafts = [];
    for (const file of acceptedFiles) {
      const sizeBytes = Math.max(0, Number(file?.size || 0));
      if (sizeBytes < 1 || sizeBytes > CHAT_ATTACHMENT_MAX_UPLOAD_BYTES) {
        actionError.value = `Each attachment must be between 1 byte and ${CHAT_ATTACHMENT_MAX_UPLOAD_BYTES} bytes.`;
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

  async function selectThread(threadId) {
    const normalizedThreadId = normalizeThreadId(threadId);
    if (!normalizedThreadId || normalizedThreadId === selectedThreadId.value) {
      return;
    }

    selectedThreadId.value = normalizedThreadId;
    actionError.value = "";
    sendStatus.value = "";
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

    if (trimmed.length > CHAT_MESSAGE_MAX_TEXT_CHARS) {
      actionError.value = `Message must be ${CHAT_MESSAGE_MAX_TEXT_CHARS} characters or fewer.`;
      return;
    }

    if (composerHasBlockingAttachments.value) {
      actionError.value = "Resolve attachment uploads before sending.";
      return;
    }

    const hasText = trimmed.length > 0;
    const hasAttachments = attachmentIds.length > 0;
    if (!hasText && !hasAttachments) {
      return;
    }

    sendPending.value = true;
    actionError.value = "";
    sendStatus.value = "";

    try {
      const payload = {
        clientMessageId: buildClientMessageId(),
        text: hasText ? trimmed : undefined,
        attachmentIds: hasAttachments ? attachmentIds : undefined
      };
      const result = await api.chat.sendThreadMessage(threadId, payload);
      composerText.value = "";
      clearComposerAttachments();
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
      normalizeText(composerText.value).length > 0 && normalizeText(composerText.value).length <= CHAT_MESSAGE_MAX_TEXT_CHARS;
    const hasUploadedAttachments = composerUploadedAttachmentIds.value.length > 0;
    if (!(
      selectedThreadId.value > 0 &&
      !sendPending.value &&
      !composerHasBlockingAttachments.value &&
      (hasText || hasUploadedAttachments)
    )) {
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
    sendStatus.value = "";

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
      sendStatus.value = result?.created ? "Direct message created." : "Direct message opened.";
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
      messageMaxChars: CHAT_MESSAGE_MAX_TEXT_CHARS,
      attachmentMaxFilesPerMessage: CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE,
      attachmentMaxUploadBytes: CHAT_ATTACHMENT_MAX_UPLOAD_BYTES
    },
    state: reactive({
      enabled,
      selectedThreadId,
      selectedThread,
      selectedThreadPeerUser,
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
      attachmentUploadPending: composerAttachmentUploadPending,
      canSend: computed(
        () =>
          Boolean(
            selectedThreadId.value > 0 &&
              !sendPending.value &&
              !composerHasBlockingAttachments.value &&
              ((normalizeText(composerText.value).length > 0 &&
                normalizeText(composerText.value).length <= CHAT_MESSAGE_MAX_TEXT_CHARS) ||
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
      selectThread,
      ensureDmThread,
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
