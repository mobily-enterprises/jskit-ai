<template>
  <section class="assistant-view">
    <v-row class="assistant-layout">
      <v-col cols="12" lg="8" class="assistant-main-col">
        <v-card rounded="lg" elevation="1" border class="assistant-main-card">
          <v-card-text class="assistant-main-card-text">
            <v-alert v-if="error" type="error" variant="tonal" density="comfortable" class="mb-3">
              {{ error }}
            </v-alert>

            <div ref="messagesPanelRef" class="messages-panel mb-3" :class="{ 'messages-panel--empty': messages.length < 1 }">
              <div v-if="messages.length < 1" class="messages-empty-state">I am here to help</div>
              <div v-for="message in messages" :key="message.id" class="message-row" :class="`message-row--${message.role}`">
                <v-avatar v-if="message.role === 'user'" size="36" class="message-avatar message-avatar--user">
                  <v-img v-if="currentUserAvatarUrl" :src="currentUserAvatarUrl" cover />
                  <span v-else class="message-avatar-initials">{{ currentUserInitials }}</span>
                </v-avatar>
                <v-avatar v-else size="36" class="message-avatar message-avatar--assistant" aria-hidden="true" />
                <div class="message-body">
                  <div class="message-meta text-caption text-medium-emphasis">
                    <span class="message-author">{{ messageAuthorLabel(message) }}</span>
                  </div>
                  <div class="message-bubble">
                    <div v-if="showAssistantTypingIndicator(message)" class="message-typing" aria-label="Assistant is typing">
                      <span class="message-typing-dot" />
                      <span class="message-typing-dot" />
                      <span class="message-typing-dot" />
                    </div>
                    <div v-else class="message-text text-body-2">{{ message.text }}</div>
                  </div>
                </div>
              </div>
            </div>

            <v-textarea
              ref="composerRef"
              v-model="input"
              class="assistant-composer"
              label="Message"
              rows="2"
              max-rows="6"
              auto-grow
              hide-details="auto"
              :disabled="isStreaming || isRestoringConversation"
              @keydown="handleInputKeydown"
            />

            <div class="assistant-actions mt-3">
              <v-checkbox v-model="sendOnEnter" label="Send on enter" hide-details density="compact" />
              <v-btn
                class="d-lg-none"
                variant="tonal"
                :disabled="isStreaming || isRestoringConversation"
                @click="conversationPickerOpen = true"
              >
                Conversations
              </v-btn>
              <v-btn
                :color="isStreaming ? 'error' : 'primary'"
                :class="{ 'assistant-stop-button': isStreaming }"
                :disabled="isStreaming ? false : !canSend"
                @click="isStreaming ? cancelStream() : sendMessage()"
              >
                {{ isStreaming ? "STOP" : "Send" }}
              </v-btn>
              <v-btn variant="text" :disabled="!canStartNewConversation" @click="startNewConversation">Start New</v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="4" class="assistant-side-col">
        <v-card rounded="lg" elevation="1" border class="d-none d-lg-flex mb-3 assistant-history-card">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">Conversation History</v-card-title>
            <template #append>
              <v-btn
                variant="text"
                size="small"
                :disabled="isStreaming || isRestoringConversation || conversationHistoryLoading"
                @click="refreshConversationHistory"
              >
                Refresh
              </v-btn>
            </template>
          </v-card-item>
          <v-divider />
          <v-card-text class="pt-2 assistant-history-card-text">
            <v-btn
              block
              variant="outlined"
              color="primary"
              class="mb-2 assistant-history-start-button"
              :disabled="!canStartNewConversation"
              @click="startNewConversation"
            >
              Start new conversation
            </v-btn>
            <div v-if="conversationHistoryError" class="text-caption text-error mb-2">{{ conversationHistoryError }}</div>
            <v-list density="compact" class="assistant-history-list">
              <v-list-item v-if="conversationHistory.length < 1" title="No conversations yet." />
              <v-list-item
                v-for="conversation in conversationHistory"
                :key="conversation.id"
                :title="conversationDisplayTitle(conversation)"
                :subtitle="conversationSubtitle(conversation)"
                :active="isActiveConversation(conversation)"
                :disabled="isStreaming || isRestoringConversation"
                @click="selectConversation(conversation)"
              />
            </v-list>
          </v-card-text>
        </v-card>

        <v-card rounded="lg" elevation="1" border class="assistant-tools-card">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">Tool Timeline</v-card-title>
          </v-card-item>
          <v-divider />
          <v-list density="compact" class="assistant-tools-list">
            <v-list-item v-if="pendingToolEvents.length < 1" title="No tool events yet." />
            <v-list-item
              v-for="toolEvent in pendingToolEvents"
              :key="toolEvent.id"
              :title="toolEvent.name"
              :subtitle="toolEvent.status"
            />
          </v-list>
        </v-card>
      </v-col>
    </v-row>

    <v-bottom-sheet v-model="conversationPickerOpen">
      <v-card rounded="t-lg" border>
        <v-card-item>
          <v-card-title class="text-subtitle-1 font-weight-bold">Conversations</v-card-title>
        </v-card-item>
        <v-divider />
        <v-card-text class="pt-3">
          <v-btn
            block
            variant="outlined"
            color="primary"
            class="mb-2"
            :disabled="!canStartNewConversation"
            @click="startNewConversationFromPicker"
          >
            Start new conversation
          </v-btn>
          <div v-if="conversationHistoryError" class="text-caption text-error mb-2">{{ conversationHistoryError }}</div>
          <v-list density="compact">
            <v-list-item v-if="conversationHistory.length < 1" title="No conversations yet." />
            <v-list-item
              v-for="conversation in conversationHistory"
              :key="conversation.id"
              :title="conversationDisplayTitle(conversation)"
              :subtitle="conversationSubtitle(conversation)"
              :active="isActiveConversation(conversation)"
              :disabled="isStreaming || isRestoringConversation"
              @click="selectConversationFromPicker(conversation)"
            />
          </v-list>
        </v-card-text>
      </v-card>
    </v-bottom-sheet>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useAssistantView } from "./useAssistantView.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";

const {
  meta: { formatConversationStartedAt, normalizeConversationStatus },
  state: {
    messages,
    input,
    sendOnEnter,
    isStreaming,
    isRestoringConversation,
    error,
    pendingToolEvents,
    conversationId,
    conversationHistory,
    conversationHistoryLoading,
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
    selectConversation,
    refreshConversationHistory
  }
} = useAssistantView();
const workspaceStore = useWorkspaceStore();

const conversationPickerOpen = ref(false);
const messagesPanelRef = ref(null);
const composerRef = ref(null);

function normalizeText(value) {
  return String(value || "").trim();
}

const currentUserScreenName = computed(() => normalizeText(workspaceStore.profileDisplayName) || "You");
const currentUserAvatarUrl = computed(() => normalizeText(workspaceStore.profileAvatarUrl));
const currentUserInitials = computed(() => {
  const raw = currentUserScreenName.value || "You";
  const parts = raw
    .split(/\s+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (parts.length < 1) {
    return "Y";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
});

function messageAuthorLabel(message) {
  const role = normalizeText(message?.role).toLowerCase();
  if (role === "user") {
    return currentUserScreenName.value;
  }
  if (role === "assistant") {
    return "Assistant";
  }

  return "System";
}

function showAssistantTypingIndicator(message) {
  return (
    normalizeText(message?.role).toLowerCase() === "assistant" &&
    normalizeText(message?.status).toLowerCase() === "streaming" &&
    normalizeText(message?.text).length < 1
  );
}

function resolveConversationActorLabel(conversation) {
  const displayName = normalizeText(conversation?.createdByUserDisplayName);
  if (displayName) {
    return displayName;
  }

  const email = normalizeText(conversation?.createdByUserEmail);
  if (email) {
    return email;
  }

  const userId = Number(conversation?.createdByUserId);
  if (Number.isInteger(userId) && userId > 0) {
    return `User #${userId}`;
  }

  return "Unknown user";
}

function conversationSubtitle(conversation) {
  const id = Number(conversation?.id) || 0;
  const status = normalizeConversationStatus(conversation?.status);
  const startedAt = formatConversationStartedAt(conversation?.startedAt);
  const messageCount = Number(conversation?.messageCount || 0);
  const actorSegment = isAdminSurface.value ? ` • ${resolveConversationActorLabel(conversation)}` : "";
  return `#${id} • ${status} • ${startedAt} • ${messageCount} messages${actorSegment}`;
}

function conversationDisplayTitle(conversation) {
  const explicitTitle = normalizeText(conversation?.title);
  if (explicitTitle) {
    return explicitTitle;
  }

  return "New conversation";
}

function isActiveConversation(conversation) {
  return String(conversation?.id || "") === String(conversationId.value || "");
}

async function selectConversationFromPicker(conversation) {
  await selectConversation(conversation);
  conversationPickerOpen.value = false;
}

function startNewConversationFromPicker() {
  startNewConversation();
  conversationPickerOpen.value = false;
}

function focusComposer(selectText = false) {
  const composer = composerRef.value;
  if (!composer) {
    return;
  }

  if (typeof composer.focus === "function") {
    composer.focus();
  }

  if (!selectText) {
    return;
  }

  const root = composer.$el instanceof HTMLElement ? composer.$el : null;
  const textarea = root ? root.querySelector("textarea") : null;
  if (textarea && typeof textarea.select === "function") {
    textarea.select();
  }
}

const lastMessageSignature = computed(() => {
  const entries = Array.isArray(messages.value) ? messages.value : [];
  const last = entries[entries.length - 1];
  if (!last) {
    return "none";
  }

  return `${entries.length}|${last.id}|${last.role}|${last.kind}|${String(last.text || "").length}|${last.status}`;
});

watch(lastMessageSignature, async () => {
  const entries = Array.isArray(messages.value) ? messages.value : [];
  const last = entries[entries.length - 1];
  if (!last || last.role !== "assistant") {
    return;
  }

  await nextTick();
  const panel = messagesPanelRef.value;
  if (!panel) {
    return;
  }

  panel.scrollTop = panel.scrollHeight;
});

watch(
  () => isStreaming.value,
  async (isNowStreaming, wasStreaming) => {
    if (isNowStreaming || !wasStreaming) {
      return;
    }

    await nextTick();
    focusComposer(true);
  }
);
</script>

<style scoped>
.assistant-main-col,
.assistant-side-col {
  min-height: 0;
}

.assistant-main-card {
  display: flex;
  flex-direction: column;
}

.assistant-main-card-text {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.messages-panel {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 10px;
  padding: 12px;
  min-height: 240px;
  overflow: auto;
  background: rgba(var(--v-theme-surface-variant), 0.14);
}

.messages-panel--empty {
  display: grid;
  place-items: center;
}

.messages-empty-state {
  text-align: center;
  font-size: clamp(1.25rem, 1.2rem + 1vw, 2rem);
  font-weight: 600;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.message-row {
  align-items: flex-end;
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.message-row--user {
  flex-direction: row-reverse;
}

.message-body {
  display: flex;
  flex-direction: column;
  max-width: min(82%, 700px);
}

.message-row--user .message-body {
  align-items: flex-end;
}

.message-avatar {
  border: 2px solid rgba(var(--v-theme-surface), 0.95);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
  flex: 0 0 auto;
}

.message-avatar--assistant {
  background: linear-gradient(180deg, #2f9a45, #1f7a35) !important;
}

.message-avatar-initials {
  color: rgba(var(--v-theme-on-primary), 1);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.message-bubble {
  --bubble-bg: rgba(var(--v-theme-surface), 0.92);
  --bubble-border: rgba(var(--v-theme-on-surface), 0.16);
  background: var(--bubble-bg);
  border: 1px solid var(--bubble-border);
  border-radius: 16px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
  padding: 10px 12px;
  position: relative;
}

.message-row--assistant .message-bubble::after,
.message-row--user .message-bubble::after {
  background: var(--bubble-bg);
  bottom: 11px;
  content: "";
  height: 12px;
  position: absolute;
  width: 12px;
}

.message-row--assistant .message-bubble::after {
  clip-path: polygon(100% 0, 0 50%, 100% 100%);
  left: -10px;
}

.message-row--user .message-bubble {
  --bubble-bg: rgba(var(--v-theme-primary), 0.14);
  --bubble-border: rgba(var(--v-theme-primary), 0.34);
}

.message-row--user .message-bubble::after {
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  right: -10px;
}

.message-meta {
  margin-bottom: 5px;
}

.message-author {
  color: rgba(var(--v-theme-on-surface), 0.84);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.message-row--user .message-author {
  color: rgba(var(--v-theme-primary), 1);
}

.message-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.message-typing {
  align-items: center;
  display: inline-flex;
  gap: 5px;
  min-height: 20px;
}

.message-typing-dot {
  animation: message-typing-blink 1.1s infinite ease-in-out;
  background: rgba(var(--v-theme-on-surface), 0.62);
  border-radius: 50%;
  display: inline-block;
  height: 7px;
  width: 7px;
}

.message-typing-dot:nth-child(2) {
  animation-delay: 0.16s;
}

.message-typing-dot:nth-child(3) {
  animation-delay: 0.32s;
}

@keyframes message-typing-blink {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

.assistant-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.assistant-composer,
.assistant-history-start-button {
  flex: 0 0 auto;
}

.assistant-stop-button {
  background-color: #c62828 !important;
  border: 3px solid #ffffff !important;
  border-radius: 0 !important;
  clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
  color: #ffffff !important;
  font-weight: 800;
  letter-spacing: 0.08em;
  min-height: 46px;
  min-width: 70px;
  text-transform: uppercase;
}

@media (min-width: 1280px) {
  .assistant-view {
    height: calc(100dvh - var(--v-layout-top, 0px) - var(--v-layout-bottom, 0px) - 32px);
    min-height: 560px;
  }

  .assistant-layout {
    height: 100%;
  }

  .assistant-main-col,
  .assistant-side-col {
    display: flex;
    height: 100%;
    flex-direction: column;
  }

  .assistant-main-card {
    flex: 1;
    min-height: 0;
  }

  .assistant-main-card-text {
    flex: 1;
    min-height: 0;
  }

  .messages-panel {
    flex: 1;
    min-height: 0;
    margin-bottom: 12px;
  }

  .assistant-history-card,
  .assistant-tools-card {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .assistant-history-card {
    flex: 1.65;
  }

  .assistant-history-card-text {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
  }

  .assistant-history-list,
  .assistant-tools-list {
    min-height: 0;
    overflow: auto;
    flex: 1;
  }

  .assistant-tools-card {
    flex: 1;
  }
}
</style>
