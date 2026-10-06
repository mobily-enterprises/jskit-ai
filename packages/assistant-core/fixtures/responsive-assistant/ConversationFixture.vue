<script setup>
import { computed, reactive, ref } from "vue";
import { createAssistantMessageDelivery } from "../../src/client/conversation/messageDelivery.js";
import AssistantConversationElement from "../../src/client/conversation/AssistantConversationElement.vue";
import { useAssistantAttachments } from "../../src/client/conversation/useAssistantAttachments.js";
import { useAssistantSuggestions } from "../../src/client/conversation/useAssistantSuggestions.js";
const phase = ref("idle");
const previewFixture = new URLSearchParams(location.search).has("preview");
const temporaryWords = ref("");
const temporaryPresent = ref(false);
const temporaryEditing = ref(false);
const newerWords = ref("");
const newerPresent = ref(false);
const newerEditing = ref(false);
const previewCanTake = ref(true);
const previewDelivery = createAssistantMessageDelivery();
const avatarFixture = new URLSearchParams(location.search).has("avatar");
const avatarToolsFixture = new URLSearchParams(location.search).has("avatarTools");
const showAvatar = ref(avatarFixture);
const avatarSize = ref("compact");
const short = ref(avatarFixture);
const showQuestions = ref(false);
const questionState = reactive({
  questions: [{ name: "next", number: 1, label: "What should happen next?", choices: [] }], answers: {},
  setAnswers(value) { questionState.answers = value; },
  dismiss() { showQuestions.value = false; }
});
const attribution = new URLSearchParams(location.search).has("attribution");
const assistantLabel = ref("Current assistant");
const draft = ref("");
const narrow = ref(false);
const submissions = ref(0);
const feedback = ref(avatarFixture);
const supportEnabled = new URLSearchParams(location.search).has("support");
const suggestionModel = ref("small-model");
const customActivity = ref(false);
const suggestions = useAssistantSuggestions({
  active: computed(() => supportEnabled && phase.value === "idle"),
  draft, configuration: computed(() => ({ model: suggestionModel.value })), debounceMs: 0,
  generate: async ({ configuration }) => [{ label: "Suggest next step", prompt: `Suggestion from ${configuration.model}` }],
  onSelect(text) { draft.value = text; }
});
const capabilitiesEnabled = new URLSearchParams(location.search).has("capabilities");
const attachmentReceipts = ref([]);
const waitingUploads = [];
function finishUploads() { for (const finish of waitingUploads.splice(0)) finish(); }
const attachments = useAssistantAttachments({
  sessionId: "fixture-conversation", maxItems: 2,
  canUpload: computed(() => capabilitiesEnabled),
  async uploadAttachment(sessionId, file, { onProgress }) {
    onProgress({ bytesSent: file.size / 2, totalBytes: file.size });
    await new Promise(resolve => waitingUploads.push(resolve));
    onProgress({ bytesSent: file.size, totalBytes: file.size });
    return { attachmentId: file.name, fileName: file.name, size: file.size, sessionId };
  },
  async deleteAttachment() { return { ok: true }; }
});
const modelId = ref("one");
const appliedModel = ref("one");
const models = reactive({
  providerRows: [{ id: "configured", label: "Configured AI" }], modelProviderId: "configured",
  modelRows: Array.from({ length: 8 }, (_, index) => ({ id: index === 0 ? "one" : `model-${index}`, label: `Model ${index + 1}` })),
  modelId, changesDisabled: computed(() => phase.value !== "idle"),
  canSave: computed(() => modelId.value !== appliedModel.value),
  selectModel(value) { modelId.value = value; },
  apply() { appliedModel.value = modelId.value; }
});
const goalEnabled = ref(new URLSearchParams(location.search).has("goal"));
const goal = ref(null);
const goalState = reactive({
  enabled: goalEnabled, goal,
  set(input) { goal.value = { ...input, status: "active", elapsedSeconds: 0, sampledAt: Date.now() }; },
  pause() { goal.value = { ...goal.value, status: "paused", elapsedSeconds: goal.value.elapsedSeconds + (Date.now() - goal.value.sampledAt) / 1000, sampledAt: Date.now() }; },
  resume() { goal.value = { ...goal.value, status: "active", sampledAt: Date.now() }; }
});
const adapter = reactive({
  delivery: previewFixture ? previewDelivery : undefined,
  conversation: {
    assistantLabel,
    previewMessages: computed(() => {
      const pending = adapter.conversation.previewMessage;
      const previews = pending ? [pending] : [];
      if (newerPresent.value) previews.push({ id: "newer", text: newerWords.value, actions: {
        canDiscard: previewCanTake.value,
        canEdit: previewCanTake.value && !temporaryPresent.value,
        editing: newerEditing.value,
        discard: id => { if (id === "newer" && previewCanTake.value) newerPresent.value = false; },
        edit: id => { if (id === "newer" && previewCanTake.value && !temporaryPresent.value) newerEditing.value = true; },
        update: (id, text) => { if (id === "newer" && newerEditing.value) newerWords.value = text; },
        send: newerEditing.value ? id => {
          if (id !== "newer" || !previewCanTake.value || !newerWords.value.trim()) return;
          adapter.conversation.turns = [...adapter.conversation.turns, { turnId: id,
            user: { messageId: id, role: "user", text: newerWords.value } }];
          newerPresent.value = false;
        } : null,
        canSend: previewCanTake.value && Boolean(newerWords.value.trim()), sending: false
      } });
      return previews;
    }),
    previewMessage: computed(() => temporaryPresent.value ? {
      id: "temporary", text: temporaryWords.value,
      actions: {
        canDiscard: previewCanTake.value,
        canEdit: previewCanTake.value,
        editing: temporaryEditing.value,
        canSend: previewCanTake.value && Boolean(temporaryWords.value.trim()),
        sending: false,
        discard(id) {
          if (id !== "temporary" || !previewCanTake.value) return;
          temporaryPresent.value = false;
          if (previewDelivery.find(id)?.status === "failed") previewDelivery.cancel(id);
        },
        edit(id) {
          if (id !== "temporary" || !previewCanTake.value) return;
          temporaryEditing.value = true;
          if (previewDelivery.find(id)?.status === "failed") previewDelivery.cancel(id);
        },
        update(id, text) {
          if (id === "temporary" && previewCanTake.value) temporaryWords.value = text;
        },
        send(id) {
          if (id !== "temporary" || !previewCanTake.value || !temporaryWords.value.trim()) return;
          adapter.conversation.turns = [{ turnId: id, user: { messageId: id, role: "user", text: temporaryWords.value } }];
          temporaryPresent.value = false;
        }
      }
    } : null),
    turns: attribution ? [
      { turnId: "one", assistantLabel: "First assistant", assistantDetails: "First model",
        assistant: { role: "assistant", text: "First answer" } },
      { turnId: "two", assistantLabel: "Second assistant", assistantDetails: "Second model",
        assistant: { role: "assistant", text: "Second answer", assistantLabel: "Message assistant", assistantDetails: "Message model" } },
      { turnId: "three", assistant: { role: "assistant", text: "Unattributed answer" } }
    ] : avatarFixture ? Array.from({ length: 20 }, (_, index) => ({
      turnId: `help-${index}`, user: { messageId: `question-${index}`, text: `Support question ${index + 1}: How can I recover my account?` },
      assistant: { messageId: `answer-${index}`, outputId: `output-${index}`, role: "assistant",
        text: `Support answer ${index + 1}: Keep your recovery email available.\n\nRead the **account instructions** and follow the [recovery link](https://example.com/help). A long message wraps inside this narrow conversation without taking space from the composer.` }
    })) : [],
    visible: true, reloadable: avatarFixture, scrollKey: "fixture", welcomeMessage: "Composer responsiveness fixture"
  },
  composer: {
    draft,
    rows: 2,
    density: computed(() => narrow.value || avatarFixture ? "compact" : "default"),
    submitOnEnter: true,
    canSend: computed(() => Boolean(draft.value.trim()) && ["idle", "active", "stopped"].includes(phase.value)),
    canStop: computed(() => ["active", "stopping"].includes(phase.value)),
    stopPending: computed(() => phase.value === "stopping"),
    submitLabel: computed(() => phase.value === "reconnecting" ? "Reconnecting…" : "Send")
  },
  suggestions, goal: goalState,
  attachments: capabilitiesEnabled ? attachments : undefined,
  models: capabilitiesEnabled ? models : undefined,
  questions: computed(() => showQuestions.value ? questionState : undefined),
  actions: {
    setDraft(value) { draft.value = value; },
    submit(payload) { attachmentReceipts.value = payload.attachments; attachments.clearAttachments(); submissions.value += 1; draft.value = ""; phase.value = "active"; },
    stop() { phase.value = "stopping"; }
  }
});
</script>
<template>
  <v-app>
    <v-main>
      <div class="controls">
        <button v-if="attribution" @click="assistantLabel = 'Next assistant'">Change assistant</button>
        <button v-for="state in ['idle', 'active', 'reconnecting', 'stopping', 'stopped']" :key="state" @click="phase = state">External {{ state }}</button>
        <button @click="narrow = !narrow">Resize pane</button>
        <button @click="feedback = !feedback">Toggle action feedback</button>
        <button v-if="supportEnabled" @click="suggestionModel = 'other-model'">Change suggestion model</button>
        <button v-if="supportEnabled" @click="customActivity = !customActivity">Custom activity</button>
        <button v-if="capabilitiesEnabled" @click="finishUploads">Finish uploads</button>
        <button @click="goalEnabled = !goalEnabled">Toggle goals</button>
        <template v-if="previewFixture">
          <button @click="temporaryWords = 'Exact temporary words'; temporaryPresent = true; temporaryEditing = false">Add temporary message</button>
          <button @click="newerWords = 'Keep newer live words'; newerPresent = true; newerEditing = false">Add newer temporary message</button>
          <button @click="previewCanTake = !previewCanTake">Toggle preview eligibility</button>
          <button @click="previewDelivery.send({ message: temporaryWords, request: { text: temporaryWords, steer: true } }, { messageId: 'temporary', deliver: async () => ({ ok: false, error: 'No active turn; explicit Edit may author a new message.' }) })">Reject preview</button>
          <button @click="adapter.conversation.turns = [{ turnId: 'temporary', user: { messageId: 'temporary', role: 'user', text: temporaryWords } }]">Accept preview</button>
          <button @click="adapter.conversation.turns = [{ turnId: 'temporary', user: { messageId: 'temporary', role: 'user', text: temporaryWords, receipt: false } }]">Unadmitted preview</button>
        </template>
        <template v-if="avatarFixture">
          <button @click="showAvatar = !showAvatar">Toggle avatar slot</button>
          <button @click="short = !short">Resize height</button>
          <button @click="showQuestions = !showQuestions">Toggle questions</button>
          <button @click="attachments.status.value = 'An upload failed. Retry or remove it.'">Show attachment error</button>
          <select v-model="avatarSize" aria-label="Avatar preference"><option v-for="size in ['hidden', 'compact', 'standard', 'large']" :key="size" :value="size">{{ size }}</option></select>
          <output class="avatar-preference">Avatar requested: {{ avatarSize }}</output>
        </template>
        <output>{{ phase }}; submitted {{ submissions }}</output>
        <output v-if="capabilitiesEnabled">Model: {{ appliedModel }}; sent files: {{ attachmentReceipts.map(item => item.fileName).join(', ') }}</output>
      </div>
      <main class="fixture" :class="{ narrow, 'fixture--avatar': avatarFixture, 'fixture--short': short }">
        <AssistantConversationElement v-model:avatar-size="avatarSize" :adapter="adapter">
          <template v-if="showAvatar" #avatar><svg viewBox="0 0 100 100" role="img" aria-label="Support assistant avatar"><circle cx="50" cy="50" r="45" fill="#6750a4" /><path d="M30 62Q50 80 70 62M35 40h1m28 0h1" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" /></svg></template>
          <template v-if="avatarToolsFixture" #avatar-tools="scope">
            <button class="fixture-avatar-tool" aria-label="Avatar tool" :data-size="scope.size" :data-height="scope.height">Tool</button>
          </template>
          <template v-if="avatarToolsFixture" #avatar-control="scope">
            <button class="fixture-avatar-tool" aria-label="Retained avatar control" :data-size="scope.size">Mic</button>
          </template>
          <template v-if="customActivity" #activity="{ activity }"><strong>Custom activity: {{ activity.label }}</strong></template>
          <template #composer-feedback><p v-if="feedback" class="feedback" role="status">Describe what you want to change.</p></template>
        </AssistantConversationElement>
      </main>
    </v-main>
  </v-app>
</template>
<style scoped>
.controls { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px; }
.controls button { border: 1px solid; padding: 4px; }
.avatar-preference { flex: 0 0 14rem; }
.fixture { height: 70vh; width: min(900px, 100%); margin: auto; }
.fixture.narrow { width: min(320px, 100%); }
.fixture--avatar { width: min(320px, 100%); }
.fixture-avatar-tool { flex: 0 0 48px; min-width: 48px; min-height: 48px; }
.fixture--short { height: 420px; }
.feedback { flex: 1 1 24rem; min-width: 0; margin: 0; }
</style>
