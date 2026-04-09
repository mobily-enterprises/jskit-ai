<template>
  <AssistantClientElement v-bind="runtime" />
</template>

<script setup>
import { AssistantClientElement } from "@jskit-ai/assistant-core/client";
import { useAssistantRuntime } from "../composables/useAssistantRuntime.js";

const props = defineProps({
  surfaceId: {
    type: String,
    required: true
  }
});

const runtime = useAssistantRuntime({
  surfaceId: props.surfaceId
});
</script>
