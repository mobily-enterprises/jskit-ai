<template>
  <section class="chat-view d-flex flex-column h-100 ga-1">
    <div class="chat-status-stack d-flex flex-column ga-1">
      <v-alert v-if="state.workspaceRoomError" type="error" variant="tonal" density="comfortable">
        {{ state.workspaceRoomError }}
      </v-alert>
      <v-alert v-if="state.actionError" type="error" variant="tonal" density="comfortable">
        {{ state.actionError }}
      </v-alert>
      <v-alert v-if="state.messagesError" type="error" variant="tonal" density="comfortable">
        {{ state.messagesError }}
      </v-alert>
      <v-alert v-if="state.inboxError" type="error" variant="tonal" density="comfortable">
        {{ state.inboxError }}
      </v-alert>
    </div>

    <section class="chat-message-section d-flex flex-column flex-grow-1 ga-1">
      <div
        class="chat-history-tools d-flex flex-column flex-md-row align-stretch align-md-center justify-space-between ga-1"
      >
        <div class="chat-history-tools-main d-flex align-center flex-wrap ga-1">
          <v-btn
            variant="text"
            size="small"
            density="compact"
            :loading="state.loadingMoreMessages"
            :disabled="!state.selectedThreadId || !state.hasMoreMessages"
            @click="actions.loadOlderMessages"
          >
            Load older
          </v-btn>
          <v-btn
            v-if="!state.inWorkspaceRoom"
            variant="text"
            size="small"
            density="compact"
            class="chat-back-link text-none font-weight-semibold px-2"
            @click="actions.backToWorkspaceRoom"
          >
            Workspace chat
          </v-btn>
          <v-btn variant="text" size="small" density="compact" :loading="state.dmPending" @click="openDmDialog">
            Start DM
          </v-btn>
        </div>

        <v-menu location="bottom end" offset="8">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              variant="text"
              icon="mdi-dots-vertical"
              size="small"
              density="compact"
              aria-label="Chat actions"
            />
          </template>
          <v-list density="comfortable" min-width="180">
            <v-list-item
              title="Refresh"
              :disabled="state.workspaceRoomPending || state.messagesLoading"
              @click="refreshCurrentThread"
            />
          </v-list>
        </v-menu>
      </div>

      <div
        ref="messagePanelRef"
        class="chat-message-panel flex-grow-1"
        :class="{ 'chat-message-panel--empty': state.messageRows.length < 1 && !state.composerError }"
        @scroll.passive="handleMessagePanelScroll"
      >
        <div v-if="state.workspaceRoomPending && !state.selectedThreadId" class="chat-empty-state">
          Opening workspace chat...
        </div>
        <div v-else-if="!state.selectedThreadId" class="chat-empty-state">
          Workspace chat is unavailable in this context.
        </div>
        <div
          v-else-if="state.messagesLoading && state.messageRows.length < 1 && !state.composerError"
          class="chat-empty-state"
        >
          Loading messages...
        </div>
        <div v-else-if="state.messageRows.length < 1 && !state.composerError" class="chat-empty-state">
          No messages yet.
        </div>

        <template v-else>
          <div
            v-for="row in state.messageRows"
            :key="row.id"
            class="chat-message-row d-flex align-end ga-2 mb-2"
            :class="{
              'flex-row-reverse': row.isMine,
              'chat-message-row--mine': row.isMine,
              'chat-message-row--group-start': row.groupStart,
              'chat-message-row--group-end': row.groupEnd
            }"
          >
            <v-avatar v-if="row.showAvatar" size="34" class="chat-message-avatar">
              <v-img v-if="row.senderAvatarUrl" :src="row.senderAvatarUrl" cover />
              <span v-else class="chat-message-avatar-initials">{{ rowAvatarInitials(row) }}</span>
            </v-avatar>
            <span v-else class="chat-message-avatar-spacer" />

            <div class="chat-message-body d-grid ga-1">
              <div
                v-if="row.showMeta"
                class="chat-message-meta d-inline-flex ga-2 flex-wrap text-caption text-medium-emphasis"
              >
                <span>{{ row.senderLabel }}</span>
                <span>{{ helpers.formatTimestamp(row.message.sentAt) }}</span>
              </div>
              <div
                class="chat-message-bubble text-body-2"
                :class="{
                  'chat-message-bubble--mine': row.isMine,
                  'chat-message-bubble--theirs': !row.isMine
                }"
              >
                {{ helpers.formatMessageText(row.message) }}
              </div>
              <div
                v-if="Array.isArray(row.message.attachments) && row.message.attachments.length > 0"
                class="chat-message-attachments d-grid ga-1"
              >
                <a
                  v-for="attachment in row.message.attachments"
                  :key="attachment.id"
                  class="chat-message-attachment-link d-inline-flex align-center ga-1 text-primary text-caption"
                  :href="attachmentContentUrl(attachment)"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{{ attachmentLabel(attachment) }}</span>
                  <span v-if="attachmentSizeLabel(attachment)"> · {{ attachmentSizeLabel(attachment) }}</span>
                </a>
              </div>
            </div>
          </div>

          <div
            v-if="state.composerError"
            class="chat-message-row chat-message-row--mine chat-message-row--composer-error mt-1"
          >
            <span class="chat-message-avatar-spacer" />
            <div class="chat-message-body">
              <div class="chat-message-bubble chat-message-bubble--composer-error text-body-2">
                {{ state.composerError }}
              </div>
            </div>
          </div>
        </template>
      </div>

      <div
        v-if="state.typingNotice"
        class="chat-typing-indicator d-inline-flex align-center ga-1 text-medium-emphasis text-caption font-weight-medium"
        aria-live="polite"
      >
        <span>{{ state.typingNotice }}</span>
        <span class="chat-typing-dot" />
        <span class="chat-typing-dot" />
        <span class="chat-typing-dot" />
      </div>
    </section>

    <section class="chat-composer-section" :style="{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }">
      <div class="chat-composer-shell d-grid">
        <input
          ref="composerFileInputRef"
          type="file"
          multiple
          class="chat-file-input"
          @change="handleComposerFileInputChange"
        >

        <div class="chat-composer-row d-flex align-end ga-2">
          <v-btn
            variant="text"
            size="small"
            icon
            class="chat-attach-button"
            aria-label="Add attachment"
            :disabled="!state.selectedThreadId || state.sendPending"
            @click="openComposerFilePicker"
          >
            <svg
              class="chat-attach-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M21.44 11.05L12.95 19.54a5.5 5.5 0 01-7.78-7.78l8.49-8.49a3.5 3.5 0 114.95 4.95l-8.49 8.49a1.5 1.5 0 01-2.12-2.12l8.49-8.49"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </v-btn>

          <v-textarea
            ref="composerTextareaRef"
            v-model="state.composerText"
            placeholder="Message"
            aria-label="Message"
            rows="1"
            max-rows="4"
            variant="solo-filled"
            density="comfortable"
            auto-grow
            hide-details="auto"
            class="chat-composer-textarea flex-grow-1"
            :disabled="!state.selectedThreadId || state.sendPending"
            @keydown="actions.handleComposerKeydown"
          />

          <v-btn
            color="primary"
            rounded="pill"
            :loading="state.sendPending"
            :disabled="!state.canSend"
            @click="actions.sendFromComposer"
          >
            Send
          </v-btn>
        </div>

        <div class="chat-composer-meta px-1 text-caption text-medium-emphasis">
          Max {{ meta.attachmentMaxFilesPerMessage }} files, up to {{ readableUploadLimit }} each.
        </div>

        <div v-if="state.composerAttachments.length > 0" class="chat-composer-attachment-list d-grid ga-2">
          <div
            v-for="attachment in state.composerAttachments"
            :key="attachment.localId"
            class="chat-composer-attachment-row d-flex align-center ga-2"
          >
            <div class="chat-composer-attachment-main flex-grow-1">
              <div class="chat-composer-attachment-name">{{ attachment.fileName }}</div>
              <div class="chat-composer-attachment-meta text-caption text-medium-emphasis">
                {{ attachmentSizeLabel(attachment) }}
              </div>
            </div>
            <v-chip size="x-small" label :color="composerAttachmentStatusColor(attachment)" variant="tonal">
              {{ composerAttachmentStatusLabel(attachment) }}
            </v-chip>
            <v-btn
              v-if="String(attachment.status) === 'failed'"
              size="x-small"
              variant="text"
              :disabled="state.sendPending"
              @click="actions.retryComposerAttachment(attachment.localId)"
            >
              Retry
            </v-btn>
            <v-btn
              size="x-small"
              variant="text"
              color="error"
              :disabled="String(attachment.status) === 'uploading' || state.sendPending"
              @click="actions.removeComposerAttachment(attachment.localId)"
            >
              Remove
            </v-btn>
          </div>
        </div>
      </div>
    </section>

    <v-dialog v-model="dmDialogOpen" max-width="460">
      <v-card rounded="lg" border>
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">Start Direct Message</v-card-title>
          <v-card-subtitle>Select a user from your shared workspaces.</v-card-subtitle>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <v-alert v-if="state.dmCandidatesError" type="error" variant="tonal" density="comfortable" class="mb-3">
            {{ state.dmCandidatesError }}
          </v-alert>

          <div class="d-flex ga-2 align-center mb-3">
            <v-text-field
              v-model="dmSearchQuery"
              label="Search people"
              placeholder="Name or public chat id"
              hide-details
              density="comfortable"
              :disabled="state.dmPending || state.dmCandidatesLoading"
            />
            <v-btn
              variant="text"
              size="small"
              :loading="state.dmCandidatesLoading"
              :disabled="state.dmPending"
              @click="refreshDmCandidates"
            >
              Refresh
            </v-btn>
          </div>

          <div class="chat-dm-candidates">
            <v-list density="comfortable" nav class="pa-0">
              <v-list-item v-if="state.dmCandidatesLoading" title="Loading people..." />
              <v-list-item
                v-else-if="dmFilteredCandidates.length < 1"
                title="No available people found."
                subtitle="Try another search or check DM availability settings."
              />
              <v-list-item
                v-for="candidate in dmFilteredCandidates"
                v-else
                :key="candidate.userId"
                :title="candidate.displayName"
                :subtitle="`${candidate.publicChatId} · ${candidate.sharedWorkspaceCount} shared workspace${candidate.sharedWorkspaceCount === 1 ? '' : 's'}`"
              >
                <template #prepend>
                  <v-avatar size="30">
                    <v-img v-if="candidate.avatarUrl" :src="candidate.avatarUrl" cover />
                    <span v-else class="chat-thread-avatar-initials">{{
                      avatarInitialsFromLabel(candidate.displayName)
                    }}</span>
                  </v-avatar>
                </template>
                <template #append>
                  <v-btn
                    size="small"
                    variant="tonal"
                    :loading="state.dmPending"
                    :disabled="state.dmPending || state.dmCandidatesLoading"
                    @click="startDmWithCandidate(candidate)"
                  >
                    Start
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>
          </div>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" :disabled="state.dmPending" @click="closeDmDialog">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useChatView } from "../../runtime/chatRuntime.js";

const SCROLL_BOTTOM_THRESHOLD_PX = 30;

const { meta, state, helpers, actions } = useChatView();
const dmDialogOpen = ref(false);
const dmSearchQuery = ref("");
const composerFileInputRef = ref(null);
const composerTextareaRef = ref(null);
const messagePanelRef = ref(null);
const shouldAutoScrollToBottom = ref(true);
const readableUploadLimit = computed(() => formatBytes(meta.attachmentMaxUploadBytes));
const dmFilteredCandidates = computed(() => {
  const candidates = Array.isArray(state.dmCandidates) ? state.dmCandidates : [];
  const search = normalizeText(dmSearchQuery.value).toLowerCase();
  if (!search) {
    return candidates;
  }

  return candidates.filter((candidate) => {
    const name = normalizeText(candidate?.displayName).toLowerCase();
    const publicChatId = normalizeText(candidate?.publicChatId).toLowerCase();
    return name.includes(search) || publicChatId.includes(search);
  });
});

function normalizeText(value) {
  return String(value || "").trim();
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes < 1) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function avatarInitialsFromLabel(labelValue) {
  const label = normalizeText(labelValue) || "U";
  const parts = label
    .split(/\s+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (parts.length < 1) {
    return "U";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function normalizeScrollValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function distanceFromBottom(element) {
  if (!element) {
    return Number.POSITIVE_INFINITY;
  }
  const scrollTop = normalizeScrollValue(element.scrollTop);
  const scrollHeight = normalizeScrollValue(element.scrollHeight);
  const clientHeight = normalizeScrollValue(element.clientHeight);
  return Math.max(0, scrollHeight - (scrollTop + clientHeight));
}

function isScrolledToBottom(element) {
  return distanceFromBottom(element) <= SCROLL_BOTTOM_THRESHOLD_PX;
}

function scrollMessagesToBottom({ behavior = "auto" } = {}) {
  const element = messagePanelRef.value;
  if (!element) {
    return;
  }

  const targetTop = Math.max(
    0,
    normalizeScrollValue(element.scrollHeight) - normalizeScrollValue(element.clientHeight)
  );
  element.scrollTo({
    top: targetTop,
    behavior
  });
}

function handleMessagePanelScroll() {
  const element = messagePanelRef.value;
  if (!element) {
    shouldAutoScrollToBottom.value = true;
    return;
  }

  shouldAutoScrollToBottom.value = isScrolledToBottom(element);
}

function focusComposerInput() {
  const component = composerTextareaRef.value;
  if (component && typeof component.focus === "function") {
    component.focus();
    return;
  }

  const root = component?.$el || component;
  const textarea = root?.querySelector?.("textarea");
  if (textarea && typeof textarea.focus === "function") {
    textarea.focus();
  }
}

function rowAvatarInitials(row) {
  return avatarInitialsFromLabel(row?.senderLabel);
}

function attachmentContentUrl(attachment) {
  return normalizeText(attachment?.deliveryPath);
}

function attachmentLabel(attachment) {
  const name = normalizeText(attachment?.fileName);
  if (name) {
    return name;
  }

  const id = Number(attachment?.id || 0);
  return id > 0 ? `Attachment #${id}` : "Attachment";
}

function attachmentSizeLabel(attachment) {
  return formatBytes(attachment?.sizeBytes);
}

function composerAttachmentStatusColor(attachment) {
  const status = String(attachment?.status || "").toLowerCase();
  if (status === "uploaded") {
    return "success";
  }
  if (status === "uploading") {
    return "info";
  }
  if (status === "failed") {
    return "error";
  }
  return "default";
}

function composerAttachmentStatusLabel(attachment) {
  const status = String(attachment?.status || "").toLowerCase();
  if (status === "uploaded") {
    return "Uploaded";
  }
  if (status === "uploading") {
    return "Uploading";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Queued";
}

function openComposerFilePicker() {
  const input = composerFileInputRef.value;
  if (!input || typeof input.click !== "function") {
    return;
  }
  input.click();
}

async function handleComposerFileInputChange(event) {
  const files = event?.target?.files;
  await actions.addComposerFiles(files);
  if (event?.target) {
    event.target.value = "";
  }
}

function closeDmDialog() {
  dmDialogOpen.value = false;
  dmSearchQuery.value = "";
}

async function refreshDmCandidates() {
  await actions.refreshDmCandidates({
    limit: Number(meta.dmCandidatesPageSize || 100)
  });
}

async function openDmDialog() {
  dmDialogOpen.value = true;
  dmSearchQuery.value = "";
  await refreshDmCandidates();
}

async function startDmWithCandidate(candidate) {
  const threadId = await actions.ensureDmThread(candidate?.publicChatId);
  if (threadId > 0) {
    closeDmDialog();
  }
}

async function refreshCurrentThread() {
  await Promise.all([actions.refreshInbox(), actions.refreshThread()]);
}

watch(
  () => Number(state.selectedThreadId || 0),
  async (nextThreadId, previousThreadId) => {
    if (!nextThreadId) {
      return;
    }
    if (nextThreadId === Number(previousThreadId || 0)) {
      return;
    }

    shouldAutoScrollToBottom.value = true;
    await nextTick();
    scrollMessagesToBottom();
    focusComposerInput();
  }
);

watch(
  () => Number(state.latestMessage?.id || 0),
  async (nextMessageId, previousMessageId) => {
    if (!Number(state.selectedThreadId || 0)) {
      return;
    }
    if (!nextMessageId || nextMessageId === Number(previousMessageId || 0)) {
      return;
    }

    await nextTick();
    if (!shouldAutoScrollToBottom.value) {
      return;
    }

    scrollMessagesToBottom({
      behavior: Number(previousMessageId || 0) > 0 ? "smooth" : "auto"
    });
  },
  {
    immediate: true
  }
);

watch(
  () => normalizeText(state.composerError),
  async (nextComposerError, previousComposerError) => {
    if (!nextComposerError || nextComposerError === previousComposerError) {
      return;
    }
    if (!shouldAutoScrollToBottom.value) {
      return;
    }

    await nextTick();
    scrollMessagesToBottom({
      behavior: "smooth"
    });
  }
);

watch(
  () => Boolean(state.sendPending),
  async (nextPending, previousPending) => {
    if (!previousPending || nextPending) {
      return;
    }
    if (normalizeText(state.composerError)) {
      return;
    }

    await nextTick();
    focusComposerInput();
    if (shouldAutoScrollToBottom.value) {
      scrollMessagesToBottom({
        behavior: "smooth"
      });
    }
  }
);
</script>

<style scoped>
.chat-view {
  min-height: 0;
  overflow: hidden;
  padding-block: 0.1rem 0;
}

.chat-back-link {
  min-height: 30px;
}

.chat-message-section {
  min-height: 0;
  overflow: hidden;
}

.chat-history-tools-main {
  min-width: 0;
}

.chat-message-panel {
  min-height: 0;
  overflow: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(var(--v-theme-surface), 0.96) 0%, rgba(var(--v-theme-surface), 0.78) 100%);
  padding: 0.95rem 1rem;
}

.chat-message-panel--empty {
  display: grid;
  place-items: center;
}

.chat-empty-state {
  min-height: 280px;
  display: grid;
  place-items: center;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.94rem;
  text-align: center;
}

.chat-message-avatar,
.chat-message-avatar-spacer {
  width: 34px;
  min-width: 34px;
}

.chat-message-avatar-spacer {
  height: 34px;
}

.chat-message-avatar-initials,
.chat-thread-avatar-initials {
  font-size: 0.72rem;
  font-weight: 700;
}

.chat-message-body {
  min-width: 0;
  max-width: min(80%, 620px);
}

.chat-message-row--mine .chat-message-body {
  justify-items: end;
}

.chat-message-bubble {
  border-radius: 18px;
  padding: 0.58rem 0.78rem;
  white-space: pre-wrap;
  line-height: 1.4;
  border: 1px solid transparent;
}

.chat-message-bubble--mine {
  background: rgba(var(--v-theme-primary), 0.16);
  border-color: rgba(var(--v-theme-primary), 0.2);
}

.chat-message-bubble--theirs {
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-color: rgba(var(--v-theme-on-surface), 0.08);
}

.chat-message-bubble--composer-error {
  background: rgba(var(--v-theme-error), 0.12);
  border-color: rgba(var(--v-theme-error), 0.32);
  color: rgb(var(--v-theme-error));
}

.chat-message-attachment-link {
  text-decoration: none;
}

.chat-message-attachment-link:hover {
  text-decoration: underline;
}

.chat-typing-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.55);
  animation: chat-typing-blink 1.1s infinite ease-in-out;
}

.chat-typing-dot:nth-child(2) {
  animation-delay: 0.12s;
}

.chat-typing-dot:nth-child(3) {
  animation-delay: 0.24s;
}

.chat-typing-dot:nth-child(4) {
  animation-delay: 0.36s;
}

.chat-composer-section {
  flex: 0 0 auto;
  position: relative;
  padding-bottom: 0;
}

.chat-composer-shell {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-surface), 0.94);
  border-radius: 18px;
  padding: 0.4rem 0.5rem 0.55rem;
  gap: 0.3rem;
  box-shadow: 0 8px 20px rgba(17, 26, 42, 0.05);
}

.chat-attach-button {
  align-self: center;
  min-width: 34px;
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 999px !important;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  background: rgba(var(--v-theme-on-surface), 0.03) !important;
  box-shadow: none !important;
}

.chat-attach-icon {
  width: 18px;
  height: 18px;
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.74);
}

.chat-composer-textarea {
  min-width: 0;
}

.chat-composer-textarea :deep(.v-field) {
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.chat-composer-textarea :deep(.v-field__outline),
.chat-composer-textarea :deep(.v-field::before),
.chat-composer-textarea :deep(.v-field::after) {
  display: none;
}

.chat-composer-textarea :deep(.v-field__input) {
  padding-block: 0.34rem;
}

.chat-composer-textarea :deep(textarea) {
  line-height: 1.35;
}

.chat-file-input {
  display: none;
}

.chat-composer-attachment-row {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  padding: 0.35rem 0.5rem;
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.chat-composer-attachment-main {
  min-width: 0;
}

.chat-composer-attachment-name {
  font-size: 0.84rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-dm-candidates {
  max-height: 52vh;
  overflow: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
}

@keyframes chat-typing-blink {
  0%,
  80%,
  100% {
    opacity: 0.26;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-1px);
  }
}

@media (max-width: 960px) {
  .chat-view {
    padding-block: 0.05rem 0;
  }

  .chat-message-panel {
    padding: 0.7rem 0.72rem;
    border-radius: 14px;
  }

  .chat-message-body {
    max-width: min(88%, 520px);
  }

  .chat-composer-shell {
    border-radius: 16px;
    padding-inline: 0.4rem;
  }

  .chat-dm-candidates {
    max-height: 44vh;
  }
}
</style>
