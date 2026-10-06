<script setup>
import { toRef } from "vue";
import { assistantHttpClient, createAssistantApi } from "@jskit-ai/assistant-core/client";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { useAssistantConversation } from "../../src/client/composables/useAssistantConversation.js";

const props = defineProps({
  conversationId: { type: String, required: true },
  data: { type: Object, default: undefined },
  attachments: { type: Object, default: null },
  presentation: { type: Object, default: () => ({}) },
  draftWhileLoading: { type: Boolean, default: false },
  onDispatch: { type: Function, required: true }
});
const api = createAssistantApi({ request: assistantHttpClient.request,
  resolveBasePath: () => "/api/assistant/home", resolveSurfaceId: () => "home" });
const binding = useAssistantConversation({
  conversationId: toRef(props, "conversationId"), data: toRef(props, "data"),
  presentation: toRef(props, "presentation"),
  attachments: toRef(props, "attachments"),
  api: { ...api, sendConversationMessage(id, input) {
    props.onDispatch(input.messageId);
    return api.sendConversationMessage(id, input);
  } },
  clearDraftOn: "accepted", queueWhileSending: false, draftWhileLoading: props.draftWhileLoading
});
defineExpose({ runtime: binding.runtime, adapter: binding.adapter, submit: () => binding.adapter.value.actions.submit() });
</script>

<template>
  <AssistantConversationElement :adapter="binding.adapter.value" label="Accepted draft conversation" style="height: 100%" />
</template>
