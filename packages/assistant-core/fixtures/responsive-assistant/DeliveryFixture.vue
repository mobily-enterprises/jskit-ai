<script setup>
import { reactive, ref } from "vue";
import AssistantConversationElement from "../../src/client/conversation/AssistantConversationElement.vue";
import { createAssistantMessageDelivery } from "../../src/client/conversation/messageDelivery.js";

const draft = ref("");
const turns = ref([]);
const requests = ref([]);
const configuration = ref({ tone: "concise" });
const clearedFiles = ref([]);
const queueWhileSending = new URLSearchParams(location.search).has("queue");
const attachments = reactive({
  attachments: queueWhileSending ? [] : [{ attachmentId: "original-file", fileName: "original.txt" }],
  queueItems: [], canSubmit: true, canAddFiles: false,
  clearAttachments({ attachmentIds }) {
    clearedFiles.value.push(...attachmentIds);
    this.attachments = this.attachments.filter(file => !attachmentIds.includes(file.attachmentId));
  }
});
let pendingRequest;
const delivery = createAssistantMessageDelivery({ deliver(payload) {
  requests.value.push(payload);
  pendingRequest = Promise.withResolvers();
  return pendingRequest.promise;
} });
function accept() {
  const payload = requests.value.at(-1);
  turns.value = [...turns.value, { turnId: payload.messageId, user: { messageId: payload.messageId, text: payload.message },
    assistant: { text: "Accepted once." } }];
  pendingRequest.resolve({ ok: true });
}
const adapter = reactive({
  delivery, attachments,
  conversation: { turns, visible: true, scrollKey: "delivery", welcomeMessage: "Start a conversation." },
  composer: { draft, canSend: true, submitOnEnter: true, queueWhileSending },
  actions: {
    setDraft(value) { draft.value = value; }
  }
});
</script>
<template>
  <v-app>
    <main class="fixture">
      <nav>
        <button @click="pendingRequest.reject(new Error('Delivery unavailable.'))">Fail request</button>
        <button @click="accept">Accept request</button>
        <button @click="attachments.attachments.push({ attachmentId: 'new-file', fileName: 'next.txt' }); configuration = { tone: 'detailed' }">Prepare newer input</button>
        <output hidden data-requests>{{ JSON.stringify(requests) }}</output>
        <output data-files>{{ attachments.attachments.map(file => file.attachmentId).join(',') }}</output>
        <output data-cleared>{{ clearedFiles.join(',') }}</output>
      </nav>
      <AssistantConversationElement :adapter="adapter" :configuration="configuration" />
    </main>
  </v-app>
</template>
<style scoped>
.fixture { height: 95dvh; width: min(900px, 100%); margin: auto; display: flex; flex-direction: column; }
nav { display: flex; gap: 12px; flex-wrap: wrap; padding: 12px; }
nav button { border: 1px solid; padding: 4px; }
output { overflow-wrap: anywhere; min-width: 0; }
.assistant-conversation { flex: 1; }
</style>
