<script setup>
import { reactive, ref } from "vue";
import AssistantConversationElement from "../../src/client/conversation/AssistantConversationElement.vue";
import { createAssistantMessageDelivery } from "../../src/client/conversation/messageDelivery.js";

const recoveryFixture = new URLSearchParams(location.search).has("recovery");
const acceptedFixture = new URLSearchParams(location.search).has("accepted-history");
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
// A stand-in for the application's server cancel: the recovery fixture answers
// from its buttons, the others agree at once.
let cancelAnswer;
function cancelMessage(id) {
  if (!delivery.cancel(id)) return false;
  cancelAnswer = Promise.withResolvers();
  cancelAnswer.promise.then(agreed => agreed ? delivery.remove(id) : delivery.cancelFailed(id));
  if (!recoveryFixture) cancelAnswer.resolve(true);
  return true;
}
function accept() {
  const payload = requests.value.at(-1);
  const at = new Date().toISOString();
  turns.value = [...turns.value, { turnId: payload.messageId, user: { messageId: payload.messageId, text: payload.message, at },
    assistant: { text: "Accepted once.", at } }];
  pendingRequest.resolve({ ok: true });
}
if (recoveryFixture) {
  const at = minute => `2026-10-13T06:${minute}:00.000Z`;
  turns.value = [
    { turnId: "one", user: { messageId: "one", text: "Question one", at: at("01") } },
    { turnId: "two", user: { messageId: "two", text: "Question two", at: at("03") } },
    { turnId: "native", messages: [
      { messageId: "reply-one", role: "assistant", text: "Reply one", at: at("02") },
      { messageId: "reply-two", role: "assistant", text: "Reply two", at: at("04") }
    ] }
  ];
  delivery.state.messages.push({ id: "uncertain", text: "Discard failed attempt", status: "uncertain", error: "Lost response", createdAt: at("05") });
}
if (acceptedFixture) {
  turns.value = [{ turnId: "later", assistant: { text: "Later assistant reply", at: "2026-10-16T11:56:00.000Z" } }];
  delivery.state.messages.push(
    { id: "accepted-old", text: "Earlier accepted message", status: "accepted", createdAt: "2026-10-16T11:04:00.000Z" },
    { id: "queued", text: "Still queued", status: "pending", createdAt: "2026-10-16T11:03:00.000Z" }
  );
}
const adapter = reactive({
  delivery, attachments,
  conversation: { cancellableDelivery: recoveryFixture, turns, visible: true, scrollKey: "delivery", welcomeMessage: "Start a conversation." },
  composer: { draft, canSend: true, submitOnEnter: true, queueWhileSending },
  actions: {
    setDraft(value) { draft.value = value; },
    cancel: cancelMessage
  }
});
</script>
<template>
  <v-app>
    <main class="fixture">
      <nav>
        <button v-if="acceptedFixture" @click="turns.unshift({ turnId: 'earlier', user: { messageId: 'accepted-old', text: 'Earlier accepted message', at: '2026-10-16T11:05:00.000Z' } })">Load accepted history</button>
        <button v-if="recoveryFixture" @click="delivery.find('uncertain').checking = true">Start delivery check</button>
        <button v-if="recoveryFixture" @click="cancelAnswer?.resolve(false)">Server unreachable</button>
        <button v-if="recoveryFixture" @click="cancelAnswer?.resolve(true)">Server agrees to cancel</button>
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
