<template>
  <section class="assistant-view py-2 py-md-4">
    <v-row>
      <v-col cols="12" lg="8">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-bold">Assistant</v-card-title>
            <v-card-subtitle>Workspace AI chat with streaming responses and tool execution events.</v-card-subtitle>
          </v-card-item>

          <v-divider />

          <v-card-text>
            <v-alert v-if="error" type="error" variant="tonal" density="comfortable" class="mb-3">
              {{ error }}
            </v-alert>

            <div class="messages-panel mb-3">
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

      <v-col cols="12" lg="4">
        <v-card rounded="lg" elevation="1" border class="d-none d-lg-block mb-3">
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
          <v-card-text class="pt-2">
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
            <v-list density="compact">
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

        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-2 font-weight-bold">Tool Timeline</v-card-title>
          </v-card-item>
          <v-divider />
          <v-list density="compact">
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
import { ref } from "vue";
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

function conversationSubtitle(conversation) {
  const id = Number(conversation?.id) || 0;
  const status = normalizeConversationStatus(conversation?.status);
  const startedAt = formatConversationStartedAt(conversation?.startedAt);
  const messageCount = Number(conversation?.messageCount || 0);
  return `#${id} • ${status} • ${startedAt} • ${messageCount} messages`;
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
</script>

<style scoped>
.messages-panel {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 10px;
  padding: 12px;
  max-height: 340px;
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
</style>
