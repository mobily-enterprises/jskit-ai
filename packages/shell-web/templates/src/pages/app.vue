<script setup>
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import { RouterView } from "vue-router";
</script>

<template>
  <ShellLayout
    surface="app"
    surface-label="App"
    title=""
    subtitle=""
  >
    <RouterView />
  </ShellLayout>
</template>
