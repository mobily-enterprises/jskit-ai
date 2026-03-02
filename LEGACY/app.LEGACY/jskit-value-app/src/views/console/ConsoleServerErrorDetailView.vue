<template>
  <section class="console-error-detail-view py-2 py-md-4">
    <ConsoleErrorDetailClientElement mode="server" :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { ConsoleErrorDetailClientElement } from "@jskit-ai/console-errors-client-element/client";
import { useConsoleServerErrorDetailView } from "./useConsoleServerErrorDetailView.js";

const { meta, state, actions } = useConsoleServerErrorDetailView();
</script>
