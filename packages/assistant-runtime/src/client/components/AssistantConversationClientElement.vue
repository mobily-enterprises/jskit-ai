<script setup>
import { computed, ref, toRef } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { useAssistantConversation } from "../composables/useAssistantConversation.js";

const props = defineProps({
  conversationId: { type: String, required: true },
  endpoint: { type: String, default: "" },
  surfaceId: { type: String, default: "" },
  hostSurfaceId: { type: String, default: "" },
  workspaceSlug: { type: String, default: undefined },
  actorKey: { type: String, default: undefined },
  api: { type: Object, default: null },
  active: { type: Boolean, default: true },
  clearDraftOn: { type: String, default: undefined, validator: value => ["dispatch", "accepted"].includes(value) },
  assistantLabel: { type: String, default: "Assistant" },
  welcomeMessage: { type: String, default: "What would you like to do?" },
  placeholder: { type: String, default: "Message the assistant…" },
  layout: { type: String, default: "compact", validator: value => ["page", "compact"].includes(value) },
  data: { type: Object, default: undefined },
  attachments: { type: Object, default: null },
  suggestions: { type: Object, default: null },
  models: { type: Object, default: null },
  questions: { type: [Boolean, Object], default: null },
  goal: { type: [Boolean, Object], default: null }
});
const binding = useAssistantConversation({
  conversationId: toRef(props, "conversationId"), endpoint: toRef(props, "endpoint"),
  surfaceId: toRef(props, "surfaceId"), hostSurfaceId: toRef(props, "hostSurfaceId"),
  workspaceSlug: () => props.workspaceSlug, active: toRef(props, "active"),
  actorKey: toRef(props, "actorKey"), api: props.api, clearDraftOn: props.clearDraftOn,
  data: toRef(props, "data"),
  attachments: toRef(props, "attachments"), suggestions: toRef(props, "suggestions"), models: toRef(props, "models"),
  questions: toRef(props, "questions"), goal: toRef(props, "goal"),
  presentation: computed(() => ({ assistantLabel: props.assistantLabel, welcomeMessage: props.welcomeMessage,
    placeholder: props.placeholder, layout: props.layout }))
});
const conversation = ref(null);
defineExpose({ focus: () => conversation.value?.focus(), runtime: binding.runtime });
</script>

<template>
  <AssistantConversationElement ref="conversation" :adapter="binding.adapter.value" :label="assistantLabel" class="assistant-client-conversation">
    <template v-for="name in Object.keys($slots).filter(name => name !== 'composer-feedback')" #[name]="scope">
      <slot :name="name" v-bind="scope" :runtime="binding.runtime.value" />
    </template>
    <template #composer-feedback>
      <p v-if="binding.error.value" role="status" class="assistant-client-conversation__error">{{ binding.error.value }}</p>
      <slot name="composer-feedback" :runtime="binding.runtime.value" />
    </template>
  </AssistantConversationElement>
</template>

<style scoped>
.assistant-client-conversation { flex: 1 1 auto; height: 100%; min-height: 0; min-width: 0; }
.assistant-client-conversation__error { color: rgb(var(--v-theme-error)); font-size: .85rem; margin: .25rem 0; overflow-wrap: anywhere; }
</style>
