<script setup>
import { computed, reactive, ref } from "vue";
import AssistantConversationElement from "../../src/client/conversation/AssistantConversationElement.vue";
const phase = ref("idle");
const draft = ref("");
const narrow = ref(false);
const submissions = ref(0);
const adapter = reactive({
  conversation: { turns: [], visible: true, scrollKey: "fixture", welcomeMessage: "Composer responsiveness fixture" },
  composer: {
    draft,
    rows: 2,
    submitOnEnter: true,
    canSend: computed(() => Boolean(draft.value.trim()) && ["idle", "active", "stopped"].includes(phase.value)),
    canStop: computed(() => ["active", "stopping"].includes(phase.value)),
    stopPending: computed(() => phase.value === "stopping"),
    submitLabel: computed(() => phase.value === "reconnecting" ? "Reconnecting…" : "Send")
  },
  actions: {
    setDraft(value) { draft.value = value; },
    submit() { submissions.value += 1; draft.value = ""; phase.value = "active"; },
    stop() { phase.value = "stopping"; }
  }
});
</script>
<template>
  <v-app>
    <v-main>
      <div class="controls">
        <button v-for="state in ['idle', 'active', 'reconnecting', 'stopping', 'stopped']" :key="state" @click="phase = state">External {{ state }}</button>
        <button @click="narrow = !narrow">Resize pane</button>
        <output>{{ phase }}; submitted {{ submissions }}</output>
      </div>
      <main class="fixture" :class="{ narrow }">
        <AssistantConversationElement :adapter="adapter" />
      </main>
    </v-main>
  </v-app>
</template>
<style scoped>
.controls { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px; }
.controls button { border: 1px solid; padding: 4px; }
.fixture { height: 70vh; width: min(900px, 100%); margin: auto; }
.fixture.narrow { width: min(320px, 100%); }
</style>
