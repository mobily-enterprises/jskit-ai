<template>
  <section class="chat-view">
    <header class="chat-header">
      <div class="chat-header-copy">
        <p class="chat-kicker">Workspace room</p>
        <h1 class="chat-title">{{ headerTitle }}</h1>
        <p class="chat-subtitle">{{ headerSubtitle }}</p>
        <v-btn
          v-if="!state.inWorkspaceRoom"
          variant="text"
          size="small"
          class="chat-back-link"
          @click="actions.backToWorkspaceRoom"
        >
          Back to Workspace chat
        </v-btn>
      </div>

      <div class="chat-header-actions">
        <v-btn variant="tonal" size="small" :loading="state.dmPending" @click="openDmDialog">Start DM</v-btn>
        <v-menu location="bottom end" offset="8">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" icon="mdi-dots-vertical" size="small" aria-label="Chat actions" />
          </template>
          <v-list density="comfortable" min-width="180">
            <v-list-item title="Refresh" :disabled="state.workspaceRoomPending || state.messagesLoading" @click="refreshCurrentThread" />
          </v-list>
        </v-menu>
      </div>
    </header>

    <div class="chat-status-stack">
      <v-alert v-if="state.workspaceRoomError" type="error" variant="tonal" density="comfortable">
        {{ state.workspaceRoomError }}
      </v-alert>
      <v-alert v-if="state.actionError" type="error" variant="tonal" density="comfortable">
        {{ state.actionError }}
      </v-alert>
      <div v-if="state.sendStatus" class="chat-inline-status">{{ state.sendStatus }}</div>
      <v-alert v-if="state.messagesError" type="error" variant="tonal" density="comfortable">
        {{ state.messagesError }}
      </v-alert>
      <v-alert v-if="state.inboxError" type="error" variant="tonal" density="comfortable">
        {{ state.inboxError }}
      </v-alert>
    </div>

    <section class="chat-message-section">
      <div class="chat-history-tools">
        <span class="text-caption text-medium-emphasis">Load older history first, then continue chatting.</span>
        <v-btn
          variant="text"
          size="small"
          :loading="state.loadingMoreMessages"
          :disabled="!state.selectedThreadId || !state.hasMoreMessages"
          @click="actions.loadOlderMessages"
        >
          Load older
        </v-btn>
      </div>

      <div class="chat-message-panel" :class="{ 'chat-message-panel--empty': state.messageRows.length < 1 }">
        <div v-if="state.workspaceRoomPending && !state.selectedThreadId" class="chat-empty-state">Opening workspace chat...</div>
        <div v-else-if="!state.selectedThreadId" class="chat-empty-state">Workspace chat is unavailable in this context.</div>
        <div v-else-if="state.messagesLoading && state.messageRows.length < 1" class="chat-empty-state">Loading messages...</div>
        <div v-else-if="state.messageRows.length < 1" class="chat-empty-state">No messages yet.</div>

        <div
          v-for="row in state.messageRows"
          v-else
          :key="row.id"
          class="chat-message-row"
          :class="{
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

          <div class="chat-message-body">
            <div v-if="row.showMeta" class="chat-message-meta text-caption text-medium-emphasis">
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
            <div v-if="Array.isArray(row.message.attachments) && row.message.attachments.length > 0" class="chat-message-attachments">
              <a
                v-for="attachment in row.message.attachments"
                :key="attachment.id"
                class="chat-message-attachment-link"
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
      </div>

      <div v-if="state.typingNotice" class="chat-typing-indicator" aria-live="polite">
        <span>{{ state.typingNotice }}</span>
        <span class="chat-typing-dot" />
        <span class="chat-typing-dot" />
        <span class="chat-typing-dot" />
      </div>
    </section>

    <section class="chat-composer-section">
      <div class="chat-composer-shell">
        <v-textarea
          v-model="state.composerText"
          label="Message"
          placeholder="Message the workspace"
          rows="2"
          max-rows="8"
          auto-grow
          hide-details="auto"
          class="chat-composer-textarea"
          :counter="meta.messageMaxChars"
          :disabled="!state.selectedThreadId || state.sendPending"
          @keydown="actions.handleComposerKeydown"
        />

        <div class="chat-composer-toolbar">
          <div class="chat-composer-tools">
            <input
              ref="composerFileInputRef"
              type="file"
              multiple
              class="chat-file-input"
              @change="handleComposerFileInputChange"
            >
            <v-btn
              variant="text"
              size="small"
              prepend-icon="mdi-paperclip"
              :disabled="!state.selectedThreadId || state.sendPending"
              @click="openComposerFilePicker"
            >
              Add files
            </v-btn>
            <span class="text-caption text-medium-emphasis">
              Max {{ meta.attachmentMaxFilesPerMessage }} files, up to {{ readableUploadLimit }} each.
            </span>
          </div>

          <div class="chat-actions">
            <v-checkbox v-model="state.sendOnEnter" label="Send on enter" hide-details density="compact" />
            <v-btn color="primary" rounded="pill" :loading="state.sendPending" :disabled="!state.canSend" @click="actions.sendFromComposer">
              Send
            </v-btn>
          </div>
        </div>

        <div v-if="state.composerAttachments.length > 0" class="chat-composer-attachment-list">
          <div
            v-for="attachment in state.composerAttachments"
            :key="attachment.localId"
            class="chat-composer-attachment-row"
          >
            <div class="chat-composer-attachment-main">
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
                    <span v-else class="chat-thread-avatar-initials">{{ avatarInitialsFromLabel(candidate.displayName) }}</span>
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
import { computed, ref } from "vue";
import { useChatView } from "./useChatView.js";

const { meta, state, helpers, actions } = useChatView();
const dmDialogOpen = ref(false);
const dmSearchQuery = ref("");
const composerFileInputRef = ref(null);
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
const headerTitle = computed(() => {
  if (state.selectedThread) {
    return helpers.formatThreadTitle(state.selectedThread);
  }

  if (state.workspaceRoomPending) {
    return "Opening workspace chat...";
  }

  return "Workspace chat";
});
const headerSubtitle = computed(() => {
  const thread = state.selectedThread;
  if (!thread) {
    return "Everyone in this workspace can read and write.";
  }

  if (state.inWorkspaceRoom) {
    const lastMessageAt = thread?.lastMessageAt ? helpers.formatTimestamp(thread.lastMessageAt) : "No messages yet";
    return `Everyone in this workspace can read and write. ${lastMessageAt}.`;
  }

  return threadHeaderSubtitle(thread);
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

function threadHeaderSubtitle(thread) {
  const unreadCount = Number(thread?.unreadCount || 0);
  const readState = unreadCount > 0 ? `${unreadCount} unread` : "All read";
  const lastMessageAt = thread?.lastMessageAt ? helpers.formatTimestamp(thread.lastMessageAt) : "No activity yet";
  return `Direct message • ${readState} • ${lastMessageAt}`;
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
</script>

<style scoped>
.chat-view {
  --chat-gap: 1rem;
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: var(--chat-gap);
  min-height: min(82vh, 980px);
  padding-block: 0.25rem 0.8rem;
}

.chat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.9rem;
}

.chat-header-copy {
  min-width: 0;
}

.chat-kicker {
  margin: 0;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.56);
}

.chat-title {
  margin: 0.28rem 0 0;
  font-size: clamp(1.35rem, 2.2vw, 1.7rem);
  line-height: 1.16;
  font-weight: 700;
}

.chat-subtitle {
  margin: 0.32rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.92rem;
}

.chat-back-link {
  margin-top: 0.2rem;
  padding-inline: 0;
  min-height: 28px;
  text-transform: none;
  font-weight: 600;
}

.chat-header-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.chat-status-stack {
  display: grid;
  gap: 0.55rem;
}

.chat-inline-status {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  padding: 0.22rem 0.55rem;
  border-radius: 999px;
  border: 1px solid rgba(var(--v-theme-success), 0.28);
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
  font-size: 0.76rem;
  font-weight: 600;
}

.chat-message-section {
  min-height: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 0.55rem;
}

.chat-history-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.chat-message-panel {
  min-height: 360px;
  max-height: min(62vh, 700px);
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

.chat-message-row {
  display: flex;
  align-items: flex-end;
  gap: 0.55rem;
  margin-bottom: 0.45rem;
}

.chat-message-row--mine {
  flex-direction: row-reverse;
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
  display: grid;
  gap: 0.18rem;
  min-width: 0;
  max-width: min(80%, 620px);
}

.chat-message-row--mine .chat-message-body {
  justify-items: end;
}

.chat-message-meta {
  display: inline-flex;
  gap: 0.45rem;
  line-height: 1.2;
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

.chat-message-attachments {
  display: grid;
  gap: 0.3rem;
}

.chat-message-attachment-link {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
  font-size: 0.79rem;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.chat-message-attachment-link:hover {
  text-decoration: underline;
}

.chat-typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.82rem;
  font-weight: 500;
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
  position: sticky;
  bottom: 0;
  z-index: 2;
  padding-bottom: 0.1rem;
  background: linear-gradient(180deg, rgba(var(--v-theme-background), 0) 0%, rgba(var(--v-theme-background), 0.92) 24%);
}

.chat-composer-shell {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-surface), 0.94);
  border-radius: 24px;
  padding: 0.65rem 0.8rem 0.75rem;
  display: grid;
  gap: 0.45rem;
  box-shadow: 0 8px 20px rgba(17, 26, 42, 0.05);
}

.chat-composer-textarea :deep(textarea) {
  line-height: 1.42;
}

.chat-composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
}

.chat-composer-tools {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chat-file-input {
  display: none;
}

.chat-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.chat-composer-attachment-list {
  display: grid;
  gap: 0.45rem;
}

.chat-composer-attachment-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  padding: 0.35rem 0.5rem;
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.chat-composer-attachment-main {
  min-width: 0;
  flex: 1;
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
    --chat-gap: 0.75rem;
    min-height: calc(100vh - 140px);
    padding-block: 0.1rem 0.45rem;
  }

  .chat-header {
    flex-direction: column;
    align-items: stretch;
  }

  .chat-header-actions {
    justify-content: flex-start;
  }

  .chat-subtitle {
    font-size: 0.88rem;
  }

  .chat-history-tools {
    align-items: flex-start;
    flex-direction: column;
  }

  .chat-message-panel {
    min-height: 260px;
    max-height: 50vh;
    padding: 0.75rem 0.78rem;
    border-radius: 14px;
  }

  .chat-message-body {
    max-width: min(88%, 520px);
  }

  .chat-message-meta {
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .chat-composer-section {
    bottom: calc(env(safe-area-inset-bottom, 0px));
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.1rem);
  }

  .chat-composer-shell {
    border-radius: 20px;
    padding-inline: 0.65rem;
  }

  .chat-composer-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .chat-actions {
    width: 100%;
    justify-content: space-between;
  }

  .chat-dm-candidates {
    max-height: 44vh;
  }
}
</style>
