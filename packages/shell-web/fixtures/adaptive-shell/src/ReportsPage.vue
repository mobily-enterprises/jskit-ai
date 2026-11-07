<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";

const route = useRoute();
const section = computed(() => String(route.params.section || ""));
</script>

<template>
  <section class="reports-page" data-testid="fixture-reports">
    <!-- Material 3 primary tabs: one row over a divider, scrolling sideways when the tabs don't fit. -->
    <nav class="reports-page__tabs" aria-label="Report sections" data-testid="fixture-section-tabs">
      <ShellOutlet target="reports:section-nav" />
    </nav>
    <nav class="reports-page__tabs" aria-label="Report views" data-testid="fixture-bar-items-in-page">
      <ShellOutlet target="reports-views:section-nav" />
    </nav>
    <p class="text-body-medium pa-4" data-testid="fixture-report-section">{{ section }}</p>
  </section>
</template>

<style scoped>
.reports-page__tabs {
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  display: flex;
  overflow-x: auto;
}
</style>
