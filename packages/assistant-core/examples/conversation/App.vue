<template>
  <v-app>
    <main class="example">
      <header><h1>Assistant</h1><span>{{ providerLabel }}</span></header>
      <AssistantConversationElement
        :adapter="adapter" :configuration="configuration"
        :configuration-mode="configurationMode" :configuration-fields="fields"
      >
        <template #hints><p v-if="error" role="alert">{{ error }}</p></template>
      </AssistantConversationElement>
    </main>
  </v-app>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";

const turns = ref([]), draft = ref(""), loading = ref(true), pending = ref(false), error = ref("");
const providerLabel = ref(""), configurationMode = ref("hidden"), configuration = ref({ tone: "concise" });
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
    error.value = "";
  } catch (failure) { if (!disposed) error.value = failure.message; }
  finally { if (!disposed) loading.value = false; }
}

async function submit({ configuration: selectedConfiguration }) {
  if (pending.value || !draft.value.trim()) return;
  const text = draft.value;
  pending.value = true;
  error.value = "";
  const controller = new AbortController();
  request = controller;
  try {
    const response = await fetch("/api/messages", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ messageId: crypto.randomUUID(), text, configuration: selectedConfiguration })
    });
    if (!response.ok) throw new Error((await response.json()).error || "Could not send.");
    if (draft.value === text) draft.value = "";
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
  conversation: { turns, loading, visible: true, assistantLabel: "Assistant", scrollKey: "example" },
  composer: {
    draft, pending, disabled: pending, submitOnModifierEnter: true,
    canSend: computed(() => !loading.value && !pending.value && Boolean(draft.value.trim())),
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
.example header span { color: #666; font-size: .875rem; }
.example > .assistant-conversation { flex: 1; min-height: 0; }
</style>
