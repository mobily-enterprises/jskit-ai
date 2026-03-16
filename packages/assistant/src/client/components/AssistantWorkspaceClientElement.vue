<template>
  <AssistantClientElement
    :meta="runtime.meta"
    :state="runtime.state"
    :actions="runtime.actions"
    :viewer="runtime.viewer.value"
  />
</template>

<script setup>
import AssistantClientElement from "./AssistantClientElement.vue";
import { useAssistantWorkspaceRuntime } from "../composables/useAssistantWorkspaceRuntime.js";

const runtime = useAssistantWorkspaceRuntime();
</script>
