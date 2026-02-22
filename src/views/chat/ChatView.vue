<template>
  <section class="chat-view">
    <v-row dense class="chat-layout">
      <v-col cols="12" lg="4">
        <v-card rounded="lg" elevation="1" border class="chat-side-card">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">Inbox</v-card-title>
            <template #append>
              <div class="chat-side-actions">
                <v-btn variant="text" size="small" :loading="state.inboxLoading" @click="actions.refreshInbox">Refresh</v-btn>
                <v-btn variant="tonal" size="small" :loading="state.dmPending" @click="openDmDialog">Start DM</v-btn>
                <v-btn variant="text" size="small" :href="workspaceChatPath">Workspace chat</v-btn>
              </div>
            </template>
          </v-card-item>
          <v-divider />

          <v-card-text class="chat-thread-list-wrapper">
            <v-alert v-if="state.actionError" type="error" variant="tonal" density="comfortable" class="mb-3">
              {{ state.actionError }}
            </v-alert>
            <div v-if="state.sendStatus" class="chat-inline-status mb-3">
              {{ state.sendStatus }}
            </div>
            <v-alert v-if="state.inboxError" type="error" variant="tonal" density="comfortable" class="mb-3">
              {{ state.inboxError }}
            </v-alert>

            <div v-if="!state.enabled" class="text-body-2 text-medium-emphasis">
              Chat is unavailable in the current workspace context.
            </div>

            <template v-else>
              <v-list nav density="comfortable" class="pa-0 chat-thread-list">
                <v-list-item v-if="state.inboxLoading && state.threads.length < 1" title="Loading threads..." />
                <v-list-item v-else-if="state.threads.length < 1" title="No threads yet." />
                <v-list-item
                  v-for="thread in state.threads"
                  :key="thread.id"
                  :active="Number(thread.id) === Number(state.selectedThreadId)"
                  :title="helpers.formatThreadTitle(thread)"
                  :subtitle="threadSubtitle(thread)"
                  @click="actions.selectThread(thread.id)"
                >
                  <template #prepend>
                    <v-avatar size="30">
                      <v-img v-if="threadAvatarUrl(thread)" :src="threadAvatarUrl(thread)" cover />
                      <span v-else class="chat-thread-avatar-initials">{{ threadAvatarInitials(thread) }}</span>
                    </v-avatar>
                  </template>
                  <template #append>
                    <v-chip v-if="Number(thread.unreadCount || 0) > 0" size="x-small" label color="primary" variant="tonal">
                      {{ thread.unreadCount }}
                    </v-chip>
                  </template>
                </v-list-item>
              </v-list>

              <div class="d-flex justify-space-between align-center mt-3">
                <span class="text-caption text-medium-emphasis">Load older thread entries.</span>
                <v-btn
                  variant="outlined"
                  size="small"
                  :loading="state.loadingMoreThreads"
                  :disabled="!state.hasMoreThreads"
                  @click="actions.loadMoreThreads"
                >
                  Load more
                </v-btn>
              </div>
            </template>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="8">
        <v-card rounded="lg" elevation="1" border class="chat-main-card">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">
              {{ state.selectedThread ? helpers.formatThreadTitle(state.selectedThread) : "Messages" }}
            </v-card-title>
            <v-card-subtitle v-if="state.selectedThread">
              {{ threadHeaderSubtitle(state.selectedThread) }}
            </v-card-subtitle>
            <template #append>
              <v-btn variant="text" size="small" :disabled="!state.selectedThreadId || state.messagesLoading" @click="actions.refreshThread">
                Refresh
              </v-btn>
            </template>
          </v-card-item>
          <v-divider />

          <v-card-text>
            <v-alert v-if="state.messagesError" type="error" variant="tonal" density="comfortable" class="mb-3">
              {{ state.messagesError }}
            </v-alert>

            <div class="d-flex justify-space-between align-center mb-2">
              <span class="text-caption text-medium-emphasis">Load older history first, then continue chatting.</span>
              <v-btn
                variant="outlined"
                size="small"
                :loading="state.loadingMoreMessages"
                :disabled="!state.selectedThreadId || !state.hasMoreMessages"
                @click="actions.loadOlderMessages"
              >
                Load more
              </v-btn>
            </div>

            <div class="chat-message-panel" :class="{ 'chat-message-panel--empty': state.messageRows.length < 1 }">
              <div v-if="!state.selectedThreadId" class="chat-empty-state">Select a thread to start.</div>
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
                  <div
                    v-if="Array.isArray(row.message.attachments) && row.message.attachments.length > 0"
                    class="chat-message-attachments"
                  >
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

            <v-divider class="my-4" />

            <v-textarea
              v-model="state.composerText"
              label="Message"
              rows="2"
              max-rows="6"
              auto-grow
              hide-details="auto"
              :counter="meta.messageMaxChars"
              :disabled="!state.selectedThreadId || state.sendPending"
              @keydown="actions.handleComposerKeydown"
            />

            <div class="chat-composer-tools mt-3">
              <input
                ref="composerFileInputRef"
                type="file"
                multiple
                class="chat-file-input"
                @change="handleComposerFileInputChange"
              >
              <v-btn
                variant="tonal"
                size="small"
                :disabled="!state.selectedThreadId || state.sendPending"
                @click="openComposerFilePicker"
              >
                Add files
              </v-btn>
              <span class="text-caption text-medium-emphasis">
                Max {{ meta.attachmentMaxFilesPerMessage }} files, up to {{ readableUploadLimit }} each.
              </span>
            </div>

            <div v-if="state.composerAttachments.length > 0" class="chat-composer-attachment-list mt-3">
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

            <div class="chat-actions mt-3">
              <v-checkbox v-model="state.sendOnEnter" label="Send on enter" hide-details density="compact" />
              <v-btn color="primary" :loading="state.sendPending" :disabled="!state.canSend" @click="actions.sendFromComposer">
                Send
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

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
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import { useChatView } from "./useChatView.js";

const { meta, state, helpers, actions } = useChatView();
const workspaceStore = useWorkspaceStore();
const dmDialogOpen = ref(false);
const dmSearchQuery = ref("");
const composerFileInputRef = ref(null);
const workspaceChatPath = computed(() => workspaceStore.workspacePath("/workspace-chat"));
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

function threadSubtitle(thread) {
  const preview = helpers.formatThreadPreview(thread);
  const timestamp = thread?.lastMessageAt ? helpers.formatTimestamp(thread.lastMessageAt) : "";
  if (!timestamp) {
    return preview;
  }

  return `${preview} • ${timestamp}`;
}

function threadHeaderSubtitle(thread) {
  const unreadCount = Number(thread?.unreadCount || 0);
  const readState = unreadCount > 0 ? `${unreadCount} unread` : "All read";
  const scope = normalizeText(thread?.scopeKind) || "thread";
  const lastMessageAt = thread?.lastMessageAt ? helpers.formatTimestamp(thread.lastMessageAt) : "No activity yet";
  return `${scope} • ${readState} • ${lastMessageAt}`;
}

function threadAvatarUrl(thread) {
  const threadKind = String(thread?.threadKind || "").trim().toLowerCase();
  if (threadKind !== "dm") {
    return "";
  }

  return normalizeText(thread?.peerUser?.avatarUrl);
}

function threadAvatarInitials(thread) {
  const threadKind = String(thread?.threadKind || "").trim().toLowerCase();
  if (threadKind === "dm") {
    const peerDisplayName = normalizeText(thread?.peerUser?.displayName);
    if (peerDisplayName) {
      return avatarInitialsFromLabel(peerDisplayName);
    }
  }

  return avatarInitialsFromLabel(helpers.formatThreadTitle(thread));
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
</script>

<style scoped>
.chat-view {
  padding-block: 0.35rem 0.8rem;
}

.chat-layout {
  align-items: stretch;
}

.chat-side-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3rem;
  justify-content: flex-end;
}

.chat-side-card,
.chat-main-card {
  height: 100%;
}

.chat-thread-list-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 520px;
}

.chat-thread-list {
  flex: 1;
  overflow: auto;
}

.chat-thread-avatar-initials {
  font-size: 0.68rem;
  font-weight: 700;
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

.chat-message-panel {
  min-height: 360px;
  max-height: 62vh;
  overflow: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(var(--v-theme-surface), 0.95) 0%, rgba(var(--v-theme-surface), 0.75) 100%);
  padding: 0.85rem 0.9rem;
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

.chat-message-avatar-initials {
  font-size: 0.72rem;
  font-weight: 700;
}

.chat-message-body {
  display: grid;
  gap: 0.18rem;
  max-width: min(80%, 540px);
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
  border-radius: 16px;
  padding: 0.55rem 0.75rem;
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

.chat-composer-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.chat-file-input {
  display: none;
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

.chat-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}

.chat-typing-indicator {
  margin-top: 0.65rem;
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
    padding-block: 0.2rem 0.45rem;
  }

  .chat-side-actions {
    justify-content: flex-start;
  }

  .chat-thread-list-wrapper {
    min-height: 300px;
  }

  .chat-message-panel {
    min-height: 280px;
    max-height: 48vh;
    padding: 0.65rem 0.7rem;
    border-radius: 12px;
  }

  .chat-message-body {
    max-width: min(86%, 520px);
  }

  .chat-message-meta {
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .chat-composer-tools {
    align-items: flex-start;
  }

  .chat-actions {
    align-items: stretch;
    flex-direction: column;
    gap: 0.2rem;
  }

  .chat-dm-candidates {
    max-height: 44vh;
  }
}
</style>
