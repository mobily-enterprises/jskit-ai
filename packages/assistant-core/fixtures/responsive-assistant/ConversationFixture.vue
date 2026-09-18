<script setup>
import { computed, reactive, ref } from "vue";
import AssistantConversationElement from "../../src/client/conversation/AssistantConversationElement.vue";
import { useAssistantAttachments } from "../../src/client/conversation/useAssistantAttachments.js";
import { useAssistantSuggestions } from "../../src/client/conversation/useAssistantSuggestions.js";
const phase = ref("idle");
const attribution = new URLSearchParams(location.search).has("attribution");
const assistantLabel = ref("Current assistant");
const draft = ref("");
const narrow = ref(false);
const submissions = ref(0);
const feedback = ref(false);
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
  conversation: {
    assistantLabel,
    turns: attribution ? [
      { turnId: "one", assistantLabel: "First assistant", assistantDetails: "First model",
        assistant: { role: "assistant", text: "First answer" } },
      { turnId: "two", assistantLabel: "Second assistant", assistantDetails: "Second model",
        assistant: { role: "assistant", text: "Second answer", assistantLabel: "Message assistant", assistantDetails: "Message model" } },
      { turnId: "three", assistant: { role: "assistant", text: "Unattributed answer" } }
    ] : [],
    visible: true, scrollKey: "fixture", welcomeMessage: "Composer responsiveness fixture"
  },
  composer: {
    draft,
    rows: 2,
    density: computed(() => narrow.value ? "compact" : "default"),
    submitOnEnter: true,
    canSend: computed(() => Boolean(draft.value.trim()) && ["idle", "active", "stopped"].includes(phase.value)),
    canStop: computed(() => ["active", "stopping"].includes(phase.value)),
    stopPending: computed(() => phase.value === "stopping"),
    submitLabel: computed(() => phase.value === "reconnecting" ? "Reconnecting…" : "Send")
  },
  suggestions, goal: goalState,
  attachments: capabilitiesEnabled ? attachments : undefined,
  models: capabilitiesEnabled ? models : undefined,
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
        <output>{{ phase }}; submitted {{ submissions }}</output>
        <output v-if="capabilitiesEnabled">Model: {{ appliedModel }}; sent files: {{ attachmentReceipts.map(item => item.fileName).join(', ') }}</output>
      </div>
      <main class="fixture" :class="{ narrow }">
        <AssistantConversationElement :adapter="adapter">
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
.fixture { height: 70vh; width: min(900px, 100%); margin: auto; }
.fixture.narrow { width: min(320px, 100%); }
.feedback { flex: 1 1 24rem; min-width: 0; margin: 0; }
</style>
