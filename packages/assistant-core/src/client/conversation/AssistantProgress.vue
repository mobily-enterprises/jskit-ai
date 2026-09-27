<template>
  <div class="assistant-progress">
    <button
      v-if="expanded || messages.length > previewMessages.length"
      :aria-expanded="expanded"
      class="assistant-progress__toggle"
      type="button"
      @click="expanded = !expanded"
    >
      {{ toggleLabel }}
    </button>
    <div
      v-for="(message, index) in visibleMessages"
      :key="message.key || message.id || index"
      class="assistant-progress__message"
    >
      {{ message.text }}
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  messages: { type: Array, default: () => [] },
  pending: { type: Boolean, default: false },
  previewLimit: { type: Number, default: 2 }
});
const expanded = ref(false);
const previewCount = computed(() => props.pending ? props.previewLimit : 0);
// Applications may retain detailed progress for expansion without previewing it.
const previewMessages = computed(() => previewCount.value > 0
  ? props.messages.filter(message => message.preview !== false).slice(-previewCount.value)
  : []);
const visibleMessages = computed(() => {
  if (expanded.value) {
    return props.messages;
  }
  return previewMessages.value;
});
const toggleLabel = computed(() => {
  if (expanded.value) {
    return previewMessages.value.length > 0
      ? `Show latest ${previewMessages.value.length} progress ${previewMessages.value.length === 1 ? "update" : "updates"}`
      : "Hide progress updates";
  }
  return `Show all ${props.messages.length} progress ${props.messages.length === 1 ? "update" : "updates"}`;
});
</script>

<style scoped>
.assistant-progress {
  color: rgba(var(--v-theme-on-surface), 0.58);
  display: grid;
  font-size: 0.78rem;
  gap: 0.18rem;
  line-height: 1.42;
  min-width: 0;
  overflow-wrap: anywhere;
}

.assistant-progress__message {
  white-space: pre-wrap;
}

.assistant-progress__toggle {
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
  justify-self: start;
  padding: 0.12rem 0;
  text-align: left;
}

.assistant-progress__toggle:hover {
  text-decoration: underline;
}

.assistant-progress__toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

@media (pointer: coarse) {
  .assistant-progress__toggle {
    min-height: 3rem;
  }
}
</style>
