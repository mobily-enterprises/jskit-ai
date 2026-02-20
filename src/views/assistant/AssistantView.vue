<template>
  <section class="assistant-view">
    <v-row class="assistant-layout">
      <v-col cols="12" lg="8" class="assistant-main-col">
        <v-card rounded="lg" elevation="1" border class="assistant-main-card">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">Assistant</v-card-title>
            <v-card-subtitle>Workspace AI chat with streaming responses and tool execution events.</v-card-subtitle>
          </v-card-item>

          <v-divider />

          <v-card-text class="assistant-main-card-text">
            <v-alert v-if="error" type="error" variant="tonal" density="comfortable" class="mb-3">
              {{ error }}
            </v-alert>

            <div ref="messagesPanelRef" class="messages-panel mb-3">
              <div v-if="messages.length < 1" class="text-medium-emphasis text-body-2">No messages yet.</div>
              <div v-for="message in messages" :key="message.id" class="message-row" :class="`message-row--${message.role}`">
                <div class="message-meta text-caption text-medium-emphasis">
                  {{ message.role }}
                  <span v-if="message.status"> • {{ message.status }}</span>
                </div>
                <div class="message-text text-body-2">{{ message.text }}</div>
              </div>
            </div>

            <v-textarea
              v-model="input"
              label="Message"
              rows="3"
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
              <v-btn color="primary" :loading="isStreaming" :disabled="!canSend" @click="sendMessage">Send</v-btn>
              <v-btn variant="outlined" :disabled="!isStreaming" @click="cancelStream">Cancel</v-btn>
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
              class="mb-2"
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
                :title="`Conversation #${conversation.id}`"
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
              :title="`Conversation #${conversation.id}`"
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

const conversationPickerOpen = ref(false);
const messagesPanelRef = ref(null);

function normalizeText(value) {
  return String(value || "").trim();
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
}

.messages-panel {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 10px;
  padding: 12px;
  min-height: 240px;
  overflow: auto;
  background: rgba(var(--v-theme-surface-variant), 0.14);
}

.message-row {
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 8px;
  background: rgba(var(--v-theme-surface), 0.7);
}

.message-row--user {
  border-left: 3px solid rgba(var(--v-theme-primary), 0.8);
}

.message-row--assistant {
  border-left: 3px solid rgba(var(--v-theme-on-surface), 0.36);
}

.message-meta {
  margin-bottom: 4px;
}

.assistant-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
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
    flex: 1;
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
