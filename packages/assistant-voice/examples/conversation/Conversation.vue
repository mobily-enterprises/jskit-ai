<script setup>
import { ref } from "vue";
import { AssistantConversationClientElement } from "@jskit-ai/assistant-runtime/client";

defineProps({ id: { type: String, required: true }, label: { type: String, required: true } });
const emit = defineEmits(["voice"]);
const view = ref(null);
defineExpose({ focus: () => view.value?.focus() });
</script>

<template>
  <AssistantConversationClientElement
    ref="view" :conversation-id="id" :assistant-label="label" class="example-conversation"
  >
    <template #composer-tools="{ runtime }">
      <v-btn
        size="small" variant="text" :disabled="!runtime?.available.value"
        @click="emit('voice', runtime)"
      >
        Voice chat with {{ label }}
      </v-btn>
    </template>
  </AssistantConversationClientElement>
</template>

<style scoped>
.example-conversation { height: 100%; min-height: 0; }
</style>
