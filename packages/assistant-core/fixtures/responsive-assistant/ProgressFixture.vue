<script setup>
import { computed, ref } from "vue";
import AssistantConversationElement from "../../src/client/conversation/AssistantConversationElement.vue";
import { conversationTurnsFromMessages } from "../../src/shared/conversation/turns.js";

const working = ref(true);
const draft = ref("");
const scope = ref("first");
const combined = ref(false);
const messages = ref([1, 2, 3].map(index => ({
  messageId: `progress-${index}`, role: "thinking", text: `Reasoning ${index}`
})));
let sequence = 3;
function append(role) {
  sequence += 1;
  messages.value.push({ messageId: `message-${sequence}`, role, text: `${role} ${sequence}` });
}
const adapter = computed(() => ({
  conversation: {
    working: working.value, scrollKey: scope.value, hasMoreBefore: true,
    turns: combined.value
      ? conversationTurnsFromMessages(messages.value)
      : messages.value.map(message => ({
          turnId: `row-${message.messageId}`,
          ...(message.role === "system" || message.role === "user"
            ? { [message.role]: { messageId: message.messageId, text: message.text } } : {}),
          messages: [message]
        }))
  },
  composer: { draft: draft.value, canSend: Boolean(draft.value), canStop: working.value },
  actions: {
    setDraft(value) { draft.value = value; },
    stop() { working.value = false; },
    loadMore({ complete }) {
      messages.value.unshift({ messageId: `older-${sequence++}`, role: "thinking", text: "Older reasoning" });
      complete({ changed: true });
    }
  }
}));
</script>
<template>
  <v-app>
    <v-main>
      <main class="progress-fixture">
        <nav>
          <button @click="working = !working">Toggle working</button>
          <button @click="combined = !combined">Change storage rows</button>
          <button @click="scope = scope === 'first' ? 'second' : 'first'">Change conversation</button>
          <button v-for="role in ['thinking', 'commentary', 'assistant', 'user', 'system']" :key="role" @click="append(role)">Append {{ role }}</button>
        </nav>
        <AssistantConversationElement :adapter="adapter" />
      </main>
    </v-main>
  </v-app>
</template>
<style scoped>
.progress-fixture { display: flex; flex-direction: column; height: 100dvh; padding: 8px; }
nav { display: flex; flex-wrap: wrap; gap: 8px; flex: 0 0 auto; }
nav button { padding: 8px; min-height: 48px; border: 1px solid; }
.assistant-conversation { flex: 1; }
</style>
