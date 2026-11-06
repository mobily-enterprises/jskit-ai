<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { RouterView } from "vue-router";

// A main menu destination whose tabs are its own sub-views: the app bar shows its title and no Up arrow.
definePage({ meta: { jskit: { title: "Reports" } } });
</script>

<template>
  <section class="reports-section d-flex flex-column ga-4">
    <nav aria-label="Report sections">
      <v-tabs>
        <ShellOutlet target="reports:section-nav" />
      </v-tabs>
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
</style>
