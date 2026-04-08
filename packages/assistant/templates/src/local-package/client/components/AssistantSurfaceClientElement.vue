<template>
  <AssistantClientElement v-bind="runtime" />
</template>

<script setup>
import { AssistantClientElement } from "@jskit-ai/assistant-core/client";
import { useAssistantRuntime } from "../composables/useAssistantRuntime.js";

const runtime = useAssistantRuntime();
</script>
