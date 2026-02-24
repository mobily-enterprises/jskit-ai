<template>
  <section class="console-ai-transcripts-view py-2 py-md-4">
    <AssistantTranscriptExplorerClientElement mode="console" :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { AssistantTranscriptExplorerClientElement } from "@jskit-ai/assistant-transcript-explorer-client-element";
import { useConsoleAiTranscriptsView } from "./useConsoleAiTranscriptsView.js";

const { meta, state, actions } = useConsoleAiTranscriptsView();
</script>
