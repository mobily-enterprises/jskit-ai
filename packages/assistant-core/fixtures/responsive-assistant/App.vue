<script setup>
import { computed, ref } from "vue";
import AssistantConversationElement from "../../src/client/conversation/AssistantConversationElement.vue";
import { conversationTurnsFromMessages } from "../../src/shared/conversation/turns.js";
import { mergeConversationStream } from "../../src/shared/conversation/streaming.js";
const draft = ref("");
const query = new URLSearchParams(location.search);
const controls = query.has("controls");
const deferredHistory = query.has("history");
const streaming = query.has("streaming");
const liveText = ref("");
const liveMessage = computed(() => ({ messageId: "stream-answer", role: "assistant", text: liveText.value, status: "inProgress" }));
const scope = ref("one");
const loadingMore = ref(false);
const loadMoreError = ref("");
const historyRequests = ref(0);
const hasMoreBefore = ref(controls);
let completeHistory = null;
const messages = ref(Array.from({ length: 70 }, (_, index) => ({
  id: `message-${index}`, role: index % 2 ? "assistant" : "user", status: "completed",
  text: `Conversation line ${index + 1}: responsive scroll containment keeps the composer visible.\n\nMore text with **formatting**, a [link](https://example.com), and a_long_word_that_must_wrap_in_narrow_panes_without_overflow.`
})));
if (controls) messages.value[0].text = messages.value[0].text.repeat(4);
if (streaming) messages.value.push({ id: "stream-question", role: "user", text: "Show the answer as it arrives." });
function finishStream() {
  messages.value.push({ ...liveMessage.value, status: "completed" });
  liveText.value = "";
}
function finishHistory(error = "") {
  loadMoreError.value = error;
  if (!error) {
    messages.value.unshift({ id: `older-${historyRequests.value}`, role: "assistant", text: "Older conversation paragraph. ".repeat(40), status: "completed" });
  }
  loadingMore.value = false;
  completeHistory({ changed: !error });
  completeHistory = null;
}
const adapter = computed(() => ({
  conversation: {
    turns: mergeConversationStream(conversationTurnsFromMessages(messages.value), { messages: [liveMessage.value] }), scrollKey: scope.value,
    hasMoreBefore: hasMoreBefore.value, loadingMore: loadingMore.value, loadMoreError: loadMoreError.value
  },
  composer: { draft: draft.value, canSend: Boolean(draft.value.trim()), rows: 2 },
  actions: {
    setDraft(value) { draft.value = value; },
    submit() { draft.value = ""; },
    loadMore({ complete }) {
      historyRequests.value += 1;
      loadingMore.value = true;
      loadMoreError.value = "";
      completeHistory = complete;
      if (!deferredHistory) finishHistory();
    }
  }
}));
</script>
<template>
  <v-app>
    <v-main>
      <main class="assistant-responsive-fixture">
        <nav v-if="streaming">
          <button @click="liveText += 'Growing answer. '">Receive text</button>
          <button @click="finishStream">Finish answer</button>
        </nav>
        <nav v-if="controls">
          <button @click="scope = scope === 'one' ? 'two' : 'one'">Change conversation</button>
          <button @click="messages.push({ id: `added-${messages.length}`, role: 'assistant', text: 'New reply. '.repeat(30), status: 'completed' })">Append reply</button>
        </nav>
        <nav v-if="deferredHistory">
          <button :disabled="!loadingMore" @click="finishHistory()">Complete history load</button>
          <button :disabled="!loadingMore" @click="finishHistory('History unavailable')">Fail history load</button>
          <button @click="hasMoreBefore = false">Exhaust history</button>
          <output>History requests: {{ historyRequests }}</output>
        </nav>
        <AssistantConversationElement :adapter="adapter" class="assistant-responsive-fixture__conversation" />
      </main>
    </v-main>
  </v-app>
</template>
<style>
html, body, #app { height: 100%; margin: 0; min-height: 0; }
.assistant-responsive-fixture { display: flex; flex-direction: column; height: 100dvh; min-height: 0; padding: .5rem; }
.assistant-responsive-fixture nav { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 1rem; }
.assistant-responsive-fixture__conversation { flex: 1 1 auto; }
</style>
