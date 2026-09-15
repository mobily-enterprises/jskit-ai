<script setup>
import { computed, ref } from "vue";
import AssistantConversationElement from "../../src/client/conversation/AssistantConversationElement.vue";
import { conversationTurnsFromMessages } from "../../src/shared/conversation/turns.js";
const draft = ref("");
const controls = new URLSearchParams(location.search).has("controls");
const scope = ref("one");
const messages = ref(Array.from({ length: 70 }, (_, index) => ({
  id: `message-${index}`, role: index % 2 ? "assistant" : "user", status: "completed",
  text: `Conversation line ${index + 1}: responsive scroll containment keeps the composer visible.\n\nMore text with **formatting**, a [link](https://example.com), and a_long_word_that_must_wrap_in_narrow_panes_without_overflow.`
})));
if (controls) messages.value[0].text = messages.value[0].text.repeat(4);
const adapter = computed(() => ({
  conversation: { turns: conversationTurnsFromMessages(messages.value), scrollKey: scope.value, hasMoreBefore: controls },
  composer: { draft: draft.value, canSend: Boolean(draft.value.trim()), rows: 2 },
  actions: {
    setDraft(value) { draft.value = value; },
    submit() { draft.value = ""; },
    loadMore({ complete }) {
      messages.value.unshift({ id: "older", role: "assistant", text: "Older conversation paragraph. ".repeat(40), status: "completed" });
      complete({ changed: true });
    }
  }
}));
</script>
<template>
  <v-app>
    <v-main>
      <main class="assistant-responsive-fixture">
        <nav v-if="controls">
          <button @click="scope = scope === 'one' ? 'two' : 'one'">Change conversation</button>
          <button @click="messages.push({ id: `added-${messages.length}`, role: 'assistant', text: 'New reply. '.repeat(30), status: 'completed' })">Append reply</button>
        </nav>
        <AssistantConversationElement :adapter="adapter" class="assistant-responsive-fixture__conversation" />
      </main>
    </v-main>
  </v-app>
</template>
<style>
html, body, #app { height: 100%; margin: 0; min-height: 0; }
.assistant-responsive-fixture { display: flex; flex-direction: column; height: 100dvh; min-height: 0; padding: .5rem; }
.assistant-responsive-fixture nav { display: flex; flex: 0 0 auto; gap: 1rem; }
.assistant-responsive-fixture__conversation { flex: 1 1 auto; }
</style>
