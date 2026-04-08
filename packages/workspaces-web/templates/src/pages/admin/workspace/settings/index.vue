<template>
  <section class="settings-page">
    <ShellOutlet host="admin-settings" position="primary-menu" />
    <ShellOutlet host="admin-settings" position="forms" />
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
