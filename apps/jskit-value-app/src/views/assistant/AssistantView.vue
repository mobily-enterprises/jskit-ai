<template>
  <section class="assistant-view d-flex flex-column h-100 ga-1">
    <v-row class="assistant-layout h-100 flex-grow-1 my-0">
      <v-col cols="12" lg="8" class="assistant-main-col d-flex flex-column overflow-hidden">
        <v-card rounded="lg" elevation="1" border class="assistant-main-card d-flex flex-column flex-grow-1">
          <v-card-text class="assistant-main-card-text d-flex flex-column flex-grow-1">
            <v-alert v-if="error" type="error" variant="tonal" density="comfortable" class="mb-3">
              {{ error }}
            </v-alert>

            <div
              ref="messagesPanelRef"
              class="messages-panel mb-3 flex-grow-1"
              :class="{ 'messages-panel--empty': messages.length < 1 }"
              @scroll.passive="handleMessagesPanelScroll"
            >
              <div v-if="messages.length < 1" class="messages-empty-state">I am here to help</div>
              <div
                v-for="message in messages"
                :key="message.id"
                class="message-row d-flex align-end ga-2 mb-3"
                :class="[`message-row--${message.role}`, { 'flex-row-reverse': message.role === 'user' }]"
              >
                <v-avatar v-if="message.role === 'user'" size="36" class="message-avatar message-avatar--user">
                  <v-img v-if="currentUserAvatarUrl" :src="currentUserAvatarUrl" cover />
                  <span v-else class="message-avatar-initials">{{ currentUserInitials }}</span>
                </v-avatar>
                <v-avatar v-else size="36" class="message-avatar message-avatar--assistant" aria-hidden="true" />
                <div class="message-body d-flex flex-column">
                  <div class="message-meta mb-1 text-caption text-medium-emphasis">
                    <span class="message-author">{{ messageAuthorLabel(message) }}</span>
                  </div>
                  <div class="message-bubble">
                    <div
                      v-if="showAssistantTypingIndicator(message)"
                      class="message-typing d-inline-flex align-center ga-1"
                      aria-label="Assistant is typing"
                    >
                      <span class="message-typing-dot" />
                      <span class="message-typing-dot" />
                      <span class="message-typing-dot" />
                    </div>
                    <div v-else class="message-text text-body-2">{{ message.text }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="assistant-composer-shell d-grid">
              <div class="assistant-composer-row d-flex align-end ga-2">
                <v-textarea
                  ref="composerRef"
                  v-model="input"
                  class="assistant-composer-textarea flex-grow-1"
                  placeholder="Message"
                  aria-label="Message"
                  rows="1"
                  max-rows="4"
                  variant="solo-filled"
                  density="comfortable"
                  auto-grow
                  hide-details="auto"
                  :disabled="isStreaming || isRestoringConversation"
                  @keydown="handleInputKeydown"
                />

                <v-btn
                  :color="isStreaming ? 'error' : 'primary'"
                  :class="{ 'assistant-stop-button': isStreaming }"
                  :disabled="isStreaming ? false : !canSend"
                  @click="isStreaming ? cancelStream() : sendMessage()"
                >
                  {{ isStreaming ? "STOP" : "Send" }}
                </v-btn>
              </div>

              <div class="assistant-actions d-flex ga-2 flex-wrap mt-2">
                <v-btn
                  class="d-lg-none"
                  variant="tonal"
                  :disabled="isStreaming || isRestoringConversation"
                  @click="conversationPickerOpen = true"
                >
                  Conversations
                </v-btn>
              </div>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="4" class="assistant-side-col d-flex flex-column overflow-hidden">
        <v-card
          rounded="lg"
          elevation="1"
          border
          class="d-none d-lg-flex flex-column mb-3 assistant-history-card overflow-hidden"
        >
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
          <v-card-text class="pt-2 assistant-history-card-text d-flex flex-column flex-grow-1">
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
            <v-list density="compact" class="assistant-history-list flex-grow-1 overflow-y-auto">
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

        <v-card rounded="lg" elevation="1" border class="assistant-tools-card d-flex flex-column flex-grow-1 overflow-hidden">
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">Tool Timeline</v-card-title>
          </v-card-item>
          <v-divider />
          <v-list density="compact" class="assistant-tools-list flex-grow-1 overflow-y-auto">
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

const SCROLL_BOTTOM_THRESHOLD_PX = 30;

const {
  meta: { formatConversationStartedAt, normalizeConversationStatus },
  state: {
    messages,
    input,
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
const shouldAutoScrollToBottom = ref(true);

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
  const panel = messagesPanelRef.value;
  if (!panel) {
    return;
  }

  if (behavior === "auto") {
    panel.scrollTop = panel.scrollHeight;
    return;
  }

  const targetTop = Math.max(0, normalizeScrollValue(panel.scrollHeight) - normalizeScrollValue(panel.clientHeight));
  panel.scrollTo({
    top: targetTop,
    behavior
  });
}

function handleMessagesPanelScroll() {
  const panel = messagesPanelRef.value;
  if (!panel) {
    shouldAutoScrollToBottom.value = true;
    return;
  }

  shouldAutoScrollToBottom.value = isScrolledToBottom(panel);
}

const lastMessageSignature = computed(() => {
  const entries = Array.isArray(messages.value) ? messages.value : [];
  const last = entries[entries.length - 1];
  if (!last) {
    return "none";
  }

  return `${entries.length}|${last.id}|${last.role}|${last.kind}|${String(last.text || "").length}|${last.status}`;
});

watch(
  () => normalizeText(conversationId.value),
  async (nextConversationId, previousConversationId) => {
    if (!nextConversationId || nextConversationId === previousConversationId) {
      return;
    }

    shouldAutoScrollToBottom.value = true;
    await nextTick();
    scrollMessagesToBottom();
    focusComposer(false);
  },
  {
    immediate: true
  }
);

watch(
  lastMessageSignature,
  async (_nextSignature, previousSignature) => {
    const entries = Array.isArray(messages.value) ? messages.value : [];
    const last = entries[entries.length - 1];
    if (!last) {
      return;
    }

    await nextTick();
    if (!shouldAutoScrollToBottom.value) {
      return;
    }

    scrollMessagesToBottom({
      behavior: previousSignature && previousSignature !== "none" ? "smooth" : "auto"
    });
  },
  {
    immediate: true
  }
);

watch(
  () => isStreaming.value,
  async (isNowStreaming, wasStreaming) => {
    if (isNowStreaming || !wasStreaming) {
      return;
    }

    await nextTick();
    if (shouldAutoScrollToBottom.value) {
      scrollMessagesToBottom({
        behavior: "smooth"
      });
    }

    focusComposer(true);
  }
);
</script>

<style scoped>
.assistant-view {
  min-height: 0;
  overflow: hidden;
  padding-block: 0.1rem 0;
}

.assistant-layout {
  min-height: 0;
  overflow: hidden;
}

.assistant-main-col,
.assistant-side-col,
.assistant-main-card,
.assistant-main-card-text,
.assistant-history-card,
.assistant-tools-card,
.assistant-history-card-text,
.assistant-history-list,
.assistant-tools-list {
  min-height: 0;
}

.messages-panel {
  flex: 1 1 auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 10px;
  padding: 12px;
  min-height: 0;
  overflow: auto;
  background: rgba(var(--v-theme-surface-variant), 0.14);
}

.messages-panel--empty {
  display: grid;
  place-items: center;
}

.messages-empty-state {
  min-height: 240px;
  text-align: center;
  font-size: clamp(1.25rem, 1.2rem + 1vw, 2rem);
  font-weight: 600;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.message-body {
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

.assistant-composer-shell {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-surface), 0.94);
  border-radius: 18px;
  padding: 0.4rem 0.5rem;
  gap: 0.3rem;
  box-shadow: 0 8px 20px rgba(17, 26, 42, 0.05);
}

.assistant-composer-textarea {
  min-width: 0;
}

.assistant-composer-textarea :deep(.v-field) {
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.assistant-composer-textarea :deep(.v-field__outline),
.assistant-composer-textarea :deep(.v-field::before),
.assistant-composer-textarea :deep(.v-field::after) {
  display: none;
}

.assistant-composer-textarea :deep(.v-field__input) {
  padding-block: 0.34rem;
}

.assistant-composer-textarea :deep(textarea) {
  line-height: 1.35;
}

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
  .assistant-layout {
    flex-wrap: nowrap;
  }

  .assistant-history-card {
    flex: 1.65;
  }
}
</style>
