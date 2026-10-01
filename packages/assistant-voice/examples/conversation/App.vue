<script setup>
import { computed, onMounted, onScopeDispose, reactive, ref } from "vue";
import { createVoiceConversationController, VoiceConversationHost } from "@jskit-ai/assistant-voice/client";
const selected = ref("planning");
const provider = ref(""); const error = ref("");
const states = reactive({ planning: { id: "planning", label: "Planning", messages: [] }, notes: { id: "notes", label: "Notes", messages: [] } });
const drafts = reactive({ planning: "", notes: "" });
const sending = reactive({ planning: false, notes: false });
const pendingMessages = new Map();
const current = computed(() => states[selected.value]);
const controller = createVoiceConversationController({ connectSpeech: binding => `/api/conversations/${binding.id}/voice` });
async function request(url, options = {}) {
  const response = await fetch(url, options); const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Request failed.");
  return result;
}
async function reload() {
  const result = await request("/api/conversations"); provider.value = result.provider;
  for (const value of result.conversations) states[value.id] = value;
}
async function submit(id, text, messageId = crypto.randomUUID()) {
  const result = await request(`/api/conversations/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, messageId }) });
  await reload(); return result;
}
function binding(id) {
  return { id, get label() { return states[id].label; }, get state() { return states[id]; }, available: true,
    captureContext: () => ({ id }),
    submitText(text, { messageId, context }) { if (context.id !== id) throw new Error("Wrong conversation."); return submit(id, text, messageId); },
    cancelWork: () => request(`/api/conversations/${id}/stop`, { method: "POST" }) };
}
async function openVoice() { try { await controller.open({ conversation: binding(selected.value) }); } catch (cause) { error.value = cause.message; } }
async function send() {
  const id = selected.value; const text = drafts[id].trim(); if (!text || sending[id]) return;
  let pending = pendingMessages.get(id);
  if (pending?.text !== text) { pending = { text, messageId: crypto.randomUUID() }; pendingMessages.set(id, pending); }
  sending[id] = true;
  try { await submit(id, text, pending.messageId); pendingMessages.delete(id); if (drafts[id].trim() === text) drafts[id] = ""; error.value = ""; }
  catch (cause) { error.value = cause.message; }
  finally { sending[id] = false; }
}
let timer; let disposed = false;
async function poll() { try { await reload(); } catch (cause) { error.value = cause.message; } finally { if (!disposed) timer = setTimeout(poll, 500); } }
onMounted(poll);
onScopeDispose(() => { disposed = true; clearTimeout(timer); void controller.dispose(); });
</script>
<template>
  <v-app>
    <main class="example">
      <h1>Voice conversations</h1>
      <p>{{ provider }}</p>
      <v-btn-toggle v-model="selected" mandatory aria-label="Visible conversation"><v-btn value="planning">Planning</v-btn><v-btn value="notes">Notes</v-btn></v-btn-toggle>
      <v-btn color="primary" class="ml-3" @click="openVoice">Voice chat with {{ current.label }}</v-btn>
      <p v-if="error || current.error" role="alert">{{ error || current.error }}</p>
      <p>Changing this view keeps the active voice destination. Use Voice chat to switch it explicitly.</p>
      <section aria-label="Conversation messages">
        <p v-for="message in current.messages" :key="message.id"><strong>{{ message.role }}:</strong> {{ message.text }}</p>
        <p v-if="current.streamingReply"><strong>assistant:</strong> {{ current.streamingReply.text }}</p>
      </section>
      <v-textarea v-model="drafts[selected]" label="Message" rows="3" />
      <v-btn :disabled="current.status === 'working' || sending[selected]" @click="send">Send</v-btn>
    </main>
    <VoiceConversationHost :controller="controller" />
  </v-app>
</template>
<style scoped>.example { width: min(100% - 32px, 800px); margin: 24px auto; } section { min-height: 180px; } p { margin-block: 12px; white-space: pre-wrap; }</style>
