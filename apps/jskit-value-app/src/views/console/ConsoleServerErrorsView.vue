<template>
  <section class="console-errors-view py-2 py-md-4">
    <ConsoleErrorListClientElement mode="server" :meta="meta" :state="state" :actions="actions" />
  </section>
</template>

<script setup>
import { ConsoleErrorListClientElement } from "@jskit-ai/console-errors-client-element";
import { useConsoleServerErrorsView } from "./useConsoleServerErrorsView.js";

const { meta, state, actions } = useConsoleServerErrorsView();
</script>
