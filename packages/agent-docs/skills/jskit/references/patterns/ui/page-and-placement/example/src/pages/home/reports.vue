<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { RouterView } from "vue-router";

// A main menu destination whose tabs are its own sub-views: the app bar shows its title and no Up arrow.
definePage({ meta: { jskit: { title: "Reports" } } });
</script>

<template>
  <section class="reports-section d-flex flex-column ga-4">
    <!-- Material 3 primary tabs: one row over a divider, scrolling sideways when the tabs don't fit. -->
    <nav class="reports-section__tabs" aria-label="Report sections">
      <ShellOutlet target="reports:section-nav" />
    </nav>

    <div class="reports-section__content">
      <RouterView />
    </div>
  </section>
</template>

<style scoped>
.reports-section,
.reports-section__content {
  min-width: 0;
}

.reports-section__tabs {
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  display: flex;
  overflow-x: auto;
}
</style>
