<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { RouterView } from "vue-router";
</script>

<template>
  <section class="reports-section d-flex flex-column ga-4">
    <nav aria-label="Report sections">
      <v-tabs density="comfortable">
        <ShellOutlet target="reports:section-nav" />
      </v-tabs>
    </nav>

    <main class="reports-section__content">
      <RouterView />
    </main>
  </section>
</template>

<style scoped>
.reports-section,
.reports-section__content {
  min-width: 0;
}
</style>
