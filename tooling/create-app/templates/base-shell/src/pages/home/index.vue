<template>
  <section class="generated-ui-screen generated-ui-screen--app home-start-screen d-flex flex-column ga-4">
    <header>
      <p class="text-overline text-medium-emphasis mb-1">Home</p>
      <h1 class="home-start-screen__title">Home base</h1>
      <p class="text-body-2 text-medium-emphasis mb-0">
        The app runtime is online and ready for the first real workflow.
      </p>
    </header>

    <v-sheet rounded="lg" border class="home-start-screen__panel">
      <h2 class="text-h6 mb-2">No activity yet</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Recent work, saved records, and next actions will appear here once this app has data.
      </p>
    </v-sheet>
  </section>
</template>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.5rem, 3vw, 2.5rem);
  --generated-ui-screen-panel-padding: 1rem;
}

.home-start-screen {
  margin-inline: auto;
  max-width: 48rem;
}

.home-start-screen__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.08;
  margin: 0 0 0.45rem;
}

.home-start-screen__panel {
  padding: var(--generated-ui-screen-panel-padding);
}
</style>
