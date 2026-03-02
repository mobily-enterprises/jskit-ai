<template>
  <section class="console-error-detail-view py-2 py-md-4">
    <ConsoleErrorDetailClientElement mode="browser" :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { ConsoleErrorDetailClientElement } from "@jskit-ai/console-errors-client-element/client";
import { useConsoleBrowserErrorDetailView } from "./useConsoleBrowserErrorDetailView.js";

const { meta, state, actions } = useConsoleBrowserErrorDetailView();
</script>
