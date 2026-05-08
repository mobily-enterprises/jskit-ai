<template>
  <section class="home-start-screen d-flex flex-column ga-4">
    <header>
      <p class="text-overline text-medium-emphasis mb-1">Home</p>
      <h1 class="home-start-screen__title">Starter app</h1>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Core app runtime is ready. Add product packages or generate your first route when the surface plan is clear.
      </p>
    </header>

    <v-sheet rounded="lg" border class="home-start-screen__panel">
      <h2 class="text-h6 mb-2">Next useful screen</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Generate a page or install a package to turn this starter into a real app surface.
      </p>
    </v-sheet>
  </section>
</template>

<style scoped>
.home-start-screen {
  margin-inline: auto;
  max-width: 48rem;
}

.home-start-screen__title {
  font-size: clamp(1.5rem, 3vw, 2.5rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.08;
  margin: 0 0 0.45rem;
}

.home-start-screen__panel {
  padding: 1rem;
}
</style>
