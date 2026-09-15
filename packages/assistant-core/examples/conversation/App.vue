<template>
  <v-app>
    <main class="example">
      <header><h1>Assistant</h1><span>{{ providerLabel }}</span></header>
      <AssistantConversationElement
        :adapter="adapter" :configuration="configuration"
        :configuration-mode="configurationMode" :configuration-fields="fields"
      >
        <template #attachments="{ items }">
          <AssistantMessageAttachments :attachments="items || []" preview-enabled @preview="selectedAttachment = $event" />
        </template>
        <template #composer-feedback><p v-if="error" role="alert">{{ error }}</p></template>
      </AssistantConversationElement>
      <AssistantAttachmentPreview
        v-if="selectedAttachment" :attachment="selectedAttachment" :download-url="attachmentUrl"
        :preview-url="/\.(png|jpe?g|gif|webp)$/i.test(selectedAttachment.fileName) ? attachmentUrl : ''" @close="selectedAttachment = null"
      />
    </main>
  </v-app>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { AssistantConversationElement, AssistantAttachmentPreview, AssistantMessageAttachments, useAssistantAttachments, useAssistantSuggestions } from "@jskit-ai/assistant-core/client/conversation";

const turns = ref([]), draft = ref(""), loading = ref(true), pending = ref(false), error = ref("");
const accepted = ref(false);
const providerLabel = ref(""), configurationMode = ref("hidden"), configuration = ref({ tone: "concise" });
const modelChoices = ref([]), integrationId = ref(""), draftIntegrationId = ref("");
const selectedAttachment = ref(null);
const attachmentUrl = computed(() => selectedAttachment.value ? `/api/attachments/${encodeURIComponent(selectedAttachment.value.attachmentId)}` : "");
async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
const attachments = reactive(useAssistantAttachments({
  sessionId: "example", maxBytes: 2_000_000,
  uploadAttachment: (_scope, file, { signal }) => requestJson("/api/attachments", {
    method: "POST", body: file, signal,
    headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "X-File-Type": file.type || "text/plain" }
  }),
  deleteAttachment: (_scope, id) => requestJson(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE" })
}));
attachments.open = file => { selectedAttachment.value = file; };
const suggestions = reactive(useAssistantSuggestions({
  active: () => !loading.value && !pending.value,
  requestKey: () => turns.value.at(-1)?.turnId || "new",
  draft,
  generate: ({ draft, signal }) => requestJson("/api/suggestions", {
    method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft })
  }),
  onSelect: prompt => { draft.value = prompt; }
}));
const fields = [{ name: "tone", label: "Answer style", items: ["concise", "detailed"] }];
let request = null;
let disposed = false;

async function reload() {
  loading.value = true;
  try {
    const response = await fetch("/api/conversation");
    if (!response.ok) throw new Error("Could not load the conversation.");
    const data = await response.json();
    if (disposed) return;
    turns.value = data.turns;
    providerLabel.value = data.providerLabel;
    configurationMode.value = data.configurationMode;
    configuration.value = data.configuration;
    modelChoices.value = data.modelChoices;
    integrationId.value = data.integrationId;
    draftIntegrationId.value = data.integrationId;
    error.value = "";
  } catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) loading.value = false; }
}

async function submit({ configuration: selectedConfiguration, attachments: selectedFiles }) {
  if (pending.value || (!draft.value.trim() && !selectedFiles.length)) return;
  const draftSnapshot = draft.value;
  const text = draftSnapshot || "Please review the attached files.";
  pending.value = true;
  accepted.value = false;
  error.value = "";
  const controller = new AbortController();
  request = controller;
  try {
    const response = await fetch("/api/messages", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ messageId: crypto.randomUUID(), text, configuration: selectedConfiguration, integrationId: integrationId.value, attachmentIds: selectedFiles.map(file => file.attachmentId) })
    });
    if (!response.ok) throw new Error((await response.json()).error || "Could not send.");
    if (draft.value === draftSnapshot) draft.value = "";
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const event = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          if (disposed) continue;
          if (event.type === "accepted") { accepted.value = true; attachments.clearAttachments({ accepted: true, attachmentIds: selectedFiles.map(file => file.attachmentId) }); }
          if (event.type === "snapshot") turns.value = event.turns;
          if (event.type === "error") error.value = event.message;
        }
      }
    } finally { reader.releaseLock(); }
  } catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) pending.value = false; request = null; }
}

async function stop() {
  try {
    const response = await fetch("/api/run", { method: "DELETE" });
    if (!response.ok) throw new Error("Could not stop the assistant.");
  } catch (failure) { error.value = failure.message; }
}

const adapter = reactive({
  attachments,
  suggestions,
  models: computed(() => modelChoices.value.length && configurationMode.value !== "hidden" ? {
    providerRows: [{ id: "application", label: "Application AI" }], modelProviderId: "application",
    modelRows: modelChoices.value, modelId: draftIntegrationId.value,
    selectionSummary: modelChoices.value.find(item => item.id === integrationId.value)?.label,
    changesDisabled: configurationMode.value !== "editable" || pending.value,
    canSave: configurationMode.value === "editable" && !pending.value && draftIntegrationId.value !== integrationId.value,
    selectModel: value => { draftIntegrationId.value = value; },
    apply: () => { integrationId.value = draftIntegrationId.value; }
  } : null),
  conversation: { turns, loading, visible: true, assistantLabel: "Assistant", scrollKey: "example" },
  composer: {
    draft, pending: computed(() => pending.value && !accepted.value), submitOnEnter: true, submitOnModifierEnter: true,
    canSend: computed(() => !loading.value && !pending.value && Boolean(draft.value.trim() || attachments.attachments.length)),
    canStop: pending, placeholder: "Ask a question…"
  },
  actions: { reload, submit, stop,
    setDraft: (value) => { draft.value = value; },
    updateConfiguration: (value) => { configuration.value = value; }
  }
});
onMounted(reload);
onBeforeUnmount(() => { disposed = true; request?.abort(); });
</script>
<style>
html, body, #app { margin: 0; height: 100%; }
.example { display: flex; flex-direction: column; height: 100dvh; max-width: 60rem; width: 100%; margin: auto; padding: 1rem; box-sizing: border-box; }
.example header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.example h1 { font-size: 1.4rem; }
.example header span { color: rgba(var(--v-theme-on-surface), .7); font-size: .875rem; }
.example > .assistant-conversation { flex: 1; min-height: 0; }
</style>
