<script setup>
import { ConsoleErrorListClientElement } from "@jskit-ai/console-errors-client-element";
import { createConsoleErrorsRuntime } from "@jskit-ai/console-errors-client-runtime";

const { useConsoleBrowserErrorsView } = createConsoleErrorsRuntime();
const { meta, state, actions } = useConsoleBrowserErrorsView();
</script>

<template>
  <section class="console-errors-page">
    <ConsoleErrorListClientElement mode="browser" :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<style scoped>
.console-errors-page {
  display: grid;
  gap: 0.75rem;
}
</style>
