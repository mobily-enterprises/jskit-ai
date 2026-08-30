<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { RouterView } from "vue-router";
</script>

<template>
  <section class="reports-section d-flex flex-column ga-4">
    <header>
      <p class="text-overline text-medium-emphasis mb-1">Insights</p>
      <h1 class="text-h4 font-weight-medium mb-1">Reports</h1>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Review catalogue activity and completion trends.
      </p>
    </header>

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
