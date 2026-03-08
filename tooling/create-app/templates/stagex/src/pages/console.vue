<script setup>
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import { RouterView } from "vue-router";
</script>

<template>
  <ShellLayout
    surface="console"
    surface-label="Console"
    title="Console surface is ready."
    subtitle="Use this area for power-user tooling, diagnostics, and operations flows."
  >
    <RouterView />
  </ShellLayout>
</template>
