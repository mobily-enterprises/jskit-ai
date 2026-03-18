<template>
  <section class="settings-page">
    <ShellOutlet surface="admin" placement="workspace.settings.forms" />
  </section>
</template>

<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
</script>

<style scoped>
.settings-page {
  display: grid;
  gap: 1rem;
}
</style>
