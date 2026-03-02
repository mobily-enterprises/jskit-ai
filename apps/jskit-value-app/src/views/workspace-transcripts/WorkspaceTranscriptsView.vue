<template>
  <section class="workspace-transcripts-view py-2 py-md-4">
    <AssistantTranscriptExplorerClientElement mode="workspace" :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { AssistantTranscriptExplorerClientElement } from "@jskit-ai/assistant-transcript-explorer-client-element/client";
import { useWorkspaceTranscriptsView } from "./useWorkspaceTranscriptsView.js";

const { meta, state, actions } = useWorkspaceTranscriptsView();
</script>
