<script setup>
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import { RouterView } from "vue-router";
</script>

<template>
  <ShellLayout
    surface="admin"
    surface-label="Admin"
    title="Admin surface is ready."
    subtitle="Manage platform settings, operators, and governance from this surface."
  >
    <RouterView />
  </ShellLayout>
</template>
