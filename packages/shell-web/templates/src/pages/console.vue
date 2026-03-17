<script setup>
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import { RouterView } from "vue-router";
</script>

<template>
  <ShellLayout
    surface="console"
    surface-label="Console"
    title=""
    subtitle=""
  >
    <RouterView />
  </ShellLayout>
</template>
