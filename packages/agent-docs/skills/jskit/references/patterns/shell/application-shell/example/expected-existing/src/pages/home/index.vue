<template>
  <section class="home-start-screen d-flex flex-column ga-4">
    <v-sheet rounded="lg" border class="home-start-screen__panel">
      <p class="text-body-2 text-medium-emphasis mb-0">
        Recent work, saved records, and next actions will appear here once this app has data.
      </p>
    </v-sheet>
  </section>
</template>

<style scoped>
.home-start-screen {
  --home-start-panel-padding: 1rem;
  margin-inline: auto;
  max-width: 48rem;
}

.home-start-screen__panel {
  padding: var(--home-start-panel-padding);
}
</style>
