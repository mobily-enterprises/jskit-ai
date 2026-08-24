<script setup>
import { computed, ref } from "vue";
import AssistantClientElement from "../../src/client/components/AssistantClientElement.vue";

const longConversation = Array.from(
  { length: 90 },
  (_, index) => `Conversation line ${index + 1}: responsive scroll containment must keep the composer visible.`
).join("\n\n");

const messages = ref([
  {
    id: "message-1",
    role: "assistant",
    kind: "chat",
    status: "completed",
    text: longConversation
  }
]);
const input = ref("");
const isStreaming = ref(false);
const isRestoringConversation = ref(false);
const conversationId = ref("conversation-1");
const conversationHistory = ref([
  {
    id: "conversation-1",
    title: "Responsive layout regression",
    status: "completed",
    startedAt: "2026-08-24T00:00:00.000Z",
    messageCount: 1
  }
]);
const conversationHistoryLoading = ref(false);
const conversationHistoryLoadingMore = ref(false);
const conversationHistoryHasMore = ref(false);
const conversationHistoryError = ref("");
const pendingToolEvents = ref([
  {
    id: "tool-1",
    name: "assistant_action_search",
    status: "completed"
  }
]);

const state = Object.freeze({
  messages,
  input,
  isStreaming,
  isRestoringConversation,
  pendingToolEvents,
  conversationId,
  conversationHistory,
  conversationHistoryLoading,
  conversationHistoryLoadingMore,
  conversationHistoryHasMore,
  conversationHistoryError,
  isAdminSurface: ref(false),
  canSend: computed(() => input.value.trim().length > 0),
  canStartNewConversation: ref(true)
});

const actions = Object.freeze({
  async sendMessage() {},
  handleInputKeydown() {},
  async cancelStream() {},
  async startNewConversation() {},
  async selectConversation() {},
  async refreshConversationHistory() {},
  async loadMoreConversationHistory() {}
});

const meta = Object.freeze({
  formatConversationStartedAt() {
    return "Aug 24, 2026";
  }
});
</script>

<template>
  <v-app>
    <v-main>
      <main class="assistant-responsive-fixture">
        <AssistantClientElement
          :meta="meta"
          :state="state"
          :actions="actions"
          :viewer="{ displayName: 'Ada Lovelace' }"
        />
      </main>
    </v-main>
  </v-app>
</template>

<style>
html,
body,
#app {
  block-size: 100%;
  margin: 0;
  min-block-size: 0;
}

.assistant-responsive-fixture {
  block-size: 100%;
  min-block-size: 0;
}
</style>
