<script setup>
import { RouterView } from "vue-router";
import ShellErrorHost from "@jskit-ai/shell-web/client/components/ShellErrorHost";
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
</script>

<template>
  <v-app>
    <ShellLayout surface="app" surface-label="Library">
      <RouterView />
    </ShellLayout>
    <ShellErrorHost />
  </v-app>
</template>
