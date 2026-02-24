<template>
  <AssistantClientElement :meta="meta" :state="state" :actions="actions" :viewer="viewer" />
</template>

<script setup>
import { computed } from "vue";
import { AssistantClientElement } from "@jskit-ai/assistant-client-element";
import { useAssistantView } from "../../modules/assistant/runtime.js";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";

const { meta, state, actions } = useAssistantView();
const workspaceStore = useWorkspaceStore();

const viewer = computed(() => ({
  displayName: String(workspaceStore.profileDisplayName || "").trim() || "You",
  avatarUrl: String(workspaceStore.profileAvatarUrl || "").trim()
}));
</script>
