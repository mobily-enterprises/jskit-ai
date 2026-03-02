<script setup>
import { ConsoleErrorListClientElement } from "@jskit-ai/console-errors-client-element/client";
import { createConsoleErrorsRuntime } from "@jskit-ai/console-errors-client-runtime/client";

const { useConsoleServerErrorsView } = createConsoleErrorsRuntime();
const { meta, state, actions } = useConsoleServerErrorsView();
</script>

<template>
  <section class="console-errors-page">
    <ConsoleErrorListClientElement mode="server" :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<style scoped>
.console-errors-page {
  display: grid;
  gap: 0.75rem;
}
</style>
