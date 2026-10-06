<script setup>
import { inject, nextTick, onScopeDispose, ref } from "vue";
import { createVoiceConversationController, projectConversationVoiceState, VoiceConversationHost } from "@jskit-ai/assistant-voice/client";
import { ShellErrorHost } from "@jskit-ai/shell-web/client";
import Conversation from "./Conversation.vue";

const example = inject("example.application");
const closed = ref([]);
const views = new Map();
const error = ref("");
const controller = createVoiceConversationController({ connectSpeech: binding => binding.socketUrl });
async function openText(id) {
  closed.value = closed.value.filter(value => value !== id);
  await nextTick();
  views.get(id)?.focus();
}
function voiceBinding(runtime, label) {
  const identity = runtime.identity;
  let retained;
  return {
    id: JSON.stringify([identity.actorKey, identity.conversationId]), label,
    socketUrl: `/api/conversations/${encodeURIComponent(identity.conversationId)}/voice`,
    get state() { return projectConversationVoiceState({ turns: runtime.turns.value, status: runtime.snapshot.value?.status }); },
    get available() { return runtime.available.value; },
    captureContext: () => ({ ...identity }),
    retain() { retained = runtime.retain(); runtime = retained.runtime; },
    release() { retained?.release(); retained = null; },
    submitText(text, { messageId, context } = {}) {
      if (context?.actorKey !== identity.actorKey || context?.conversationId !== identity.conversationId) {
        throw new Error("This recording belongs to another conversation.");
      }
      return runtime.send({ message: text }, { messageId });
    },
    cancelWork: () => runtime.cancel(),
    openText: () => openText(identity.conversationId)
  };
}
async function openVoice(runtime, label) {
  try { await controller.open({ conversation: voiceBinding(runtime, label) }); error.value = ""; }
  catch (cause) { error.value = cause.message; }
}
onScopeDispose(() => { void controller.dispose(); });
</script>

<template>
  <v-app>
    <main class="example">
      <h1>Voice conversations</h1>
      <p>{{ example.provider }}</p>
      <p>Each chat has its own history and controls. Voice keeps its original target when you close or focus another text view.</p>
      <nav aria-label="Open a text conversation" class="example__navigation">
        <v-btn
          v-for="conversation in example.conversations" :key="conversation.id" variant="tonal"
          @click="openText(conversation.id)"
        >
          {{ conversation.label }}
        </v-btn>
      </nav>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="example__grid">
        <section
          v-for="conversation in example.conversations.filter(value => !closed.includes(value.id))"
          :key="conversation.id" :aria-label="`${conversation.label} chat`" class="example__card"
        >
          <header>
            <h2>{{ conversation.label }}</h2>
            <v-btn
              size="small" variant="text" :aria-label="`Close ${conversation.label} text view`"
              @click="closed.push(conversation.id)"
            >
              Close text
            </v-btn>
          </header>
          <Conversation
            :ref="value => value ? views.set(conversation.id, value) : views.delete(conversation.id)"
            :id="conversation.id" :label="conversation.label" @voice="runtime => openVoice(runtime, conversation.label)"
          />
        </section>
      </div>
    </main>
    <VoiceConversationHost :controller="controller" />
    <ShellErrorHost />
  </v-app>
</template>

<style scoped>
.example { width: min(100% - 32px, 1500px); margin: 24px auto; }
p { margin-block: 12px; }
.example__navigation { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.example__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 400px), 1fr)); gap: 16px; }
.example__card { display: flex; flex-direction: column; min-width: 0; height: min(720px, 85dvh); padding: 12px; border: 1px solid rgb(var(--v-theme-outline)); border-radius: 12px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
h2 { font-size: 1.1rem; }
</style>
