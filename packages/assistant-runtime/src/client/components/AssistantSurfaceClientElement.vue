<script setup>
import { computed, reactive, ref, toRef } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { useAssistantRuntime } from "../composables/useAssistantRuntime.js";
import { mapAssistantConversationTurns } from "../support/assistantRuntimeState.js";

const props = defineProps({
  surfaceId: { type: String, required: true },
  layout: { type: String, default: "page", validator: (value) => ["page", "compact"].includes(value) },
  assistantLabel: { type: String, default: "Assistant" },
  welcomeMessage: { type: String, default: "What would you like to do?" },
  placeholder: { type: String, default: "Message the assistant…" },
  showToolActivity: { type: Boolean, default: true }
});
const runtime = useAssistantRuntime({ surfaceId: toRef(props, "surfaceId") });
const state = reactive(runtime.state);
const conversation = ref(null);
const historyOpen = ref(false);
const selectedConversation = computed(() => state.conversationHistory.find((entry) => String(entry.id) === state.activeConversationId));
const turns = computed(() => mapAssistantConversationTurns(state.messages, state.pendingToolEvents, props));
const adapter = computed(() => ({
  conversation: {
    turns: turns.value,
    scrollKey: `${state.scopeKey}:${state.activeConversationId || "new"}`,
    loading: state.isRestoringConversation,
    assistantLabel: props.assistantLabel,
    welcomeMessage: state.messages.length || state.isRestoringConversation ? "" : props.welcomeMessage
  },
  composer: {
    draft: state.input,
    canSend: state.canSend,
    disabled: !state.hasRuntimeScope,
    canStop: state.isStreaming,
    stopPending: state.isCanceling,
    placeholder: props.placeholder,
    rows: 2,
    density: props.layout === "compact" ? "compact" : "default",
    submitOnEnter: true,
    submitOnModifierEnter: true
  },
  actions: {
    setDraft(value) { state.input = value; },
    submit: runtime.actions.sendMessage,
    stop: runtime.actions.cancelStream
  }
}));

function conversationSubtitle(entry) {
  const details = [runtime.meta.normalizeConversationStatus(entry.status), runtime.meta.formatConversationStartedAt(entry.startedAt), `${Number(entry.messageCount || 0)} messages`];
  if (state.isAdminSurface) {
    details.push(entry.createdByUserDisplayName || entry.createdByUserEmail || (entry.createdByUserId ? `User #${entry.createdByUserId}` : "Unknown user"));
  }
  return details.join(" · ");
}

async function selectConversation(entry) {
  historyOpen.value = false;
  await runtime.actions.selectConversation(entry);
}

function startNewConversation() {
  runtime.actions.startNewConversation();
  historyOpen.value = false;
}

defineExpose({ focus: () => conversation.value?.focus() });
</script>

<template>
  <section class="assistant-surface" :class="`assistant-surface--${layout}`" :aria-label="assistantLabel">
    <div class="assistant-surface__toolbar">
      <span class="assistant-surface__title">{{ selectedConversation?.title || 'New conversation' }}</span>
      <v-btn variant="text" @click="historyOpen = true">Conversations</v-btn>
      <v-menu v-if="showToolActivity && state.pendingToolEvents.length" location="bottom end">
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" variant="text">Activity</v-btn>
        </template>
        <v-list aria-label="Tool activity" max-height="320" max-width="360" class="assistant-surface__activity">
          <v-list-item v-for="event in state.pendingToolEvents" :key="event.id" :title="event.name" :subtitle="event.status" />
        </v-list>
      </v-menu>
    </div>
    <AssistantConversationElement ref="conversation" :adapter="adapter" label="Conversation" class="assistant-surface__conversation">
      <template #message-actions="{ message }">
        <p v-if="message.status === 'failed' && message.error" class="assistant-surface__message-error" role="status">{{ message.error }}</p>
        <p v-if="message.status === 'interrupted'" class="assistant-surface__notice" role="status">Response canceled. A tool already running may still finish.</p>
      </template>
      <template #hints>
        <p v-if="state.error && !state.messages.some((message) => message.error === state.error)" class="assistant-surface__message-error" role="status">{{ state.error }}</p>
      </template>
      <template #composer-tools><slot name="composer-tools" :runtime="runtime" /></template>
    </AssistantConversationElement>

    <v-dialog v-model="historyOpen" max-width="640" scrollable aria-label="Conversations">
      <v-card class="assistant-surface__history">
        <v-card-title>Conversations</v-card-title>
        <v-card-actions class="assistant-surface__history-actions">
          <v-btn color="primary" :disabled="!state.canStartNewConversation" @click="startNewConversation">Start new conversation</v-btn>
          <v-btn :disabled="state.conversationHistoryLoading" @click="runtime.actions.refreshConversationHistory">Refresh</v-btn>
          <v-btn @click="historyOpen = false">Close</v-btn>
        </v-card-actions>
        <v-card-text>
          <p v-if="state.conversationHistoryError" role="alert">{{ state.conversationHistoryError }}</p>
          <v-skeleton-loader v-if="state.conversationHistoryLoading && !state.conversationHistory.length" type="list-item-two-line@3" aria-label="Loading conversations" />
          <v-list v-else aria-label="Saved conversations">
            <v-list-item v-if="!state.conversationHistory.length" title="No saved conversations" />
            <v-list-item
              v-for="entry in state.conversationHistory" :key="entry.id"
              :active="String(entry.id) === state.activeConversationId"
              :title="entry.title || 'Untitled conversation'" :subtitle="conversationSubtitle(entry)"
              :disabled="state.isStreaming || state.isRestoringConversation" @click="selectConversation(entry)"
            />
          </v-list>
          <v-btn v-if="state.conversationHistoryHasMore" :disabled="state.conversationHistoryLoadingMore" variant="text" @click="runtime.actions.loadMoreConversationHistory">
            {{ state.conversationHistoryLoadingMore ? 'Loading conversations…' : 'Load older conversations' }}
          </v-btn>
        </v-card-text>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.assistant-surface { display: flex; flex-direction: column; height: 100%; max-height: 100%; min-height: 0; min-width: 0; overflow: hidden; gap: .5rem; }
.assistant-surface--page { padding: .5rem; }
.assistant-surface__toolbar { display: flex; align-items: center; flex-wrap: wrap; flex: 0 0 auto; gap: .25rem; }
.assistant-surface__title { flex: 1 1 8rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .875rem; }
.assistant-surface__conversation { flex: 1 1 auto; }
.assistant-surface__activity { overflow: auto; }
.assistant-surface__message-error, .assistant-surface__notice { font-size: .85rem; margin: .25rem 0; overflow-wrap: anywhere; }
.assistant-surface__message-error { color: rgb(var(--v-theme-error)); }
.assistant-surface__notice { color: rgba(var(--v-theme-on-surface), .75); }
.assistant-surface__history-actions { flex-wrap: wrap; }
@media (max-width: 600px), (pointer: coarse) {
  .assistant-surface__toolbar .v-btn, .assistant-surface__history .v-btn { min-height: 48px; }
}
</style>
