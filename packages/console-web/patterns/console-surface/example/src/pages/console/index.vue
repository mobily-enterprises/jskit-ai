<template>
  <section class="console-home-screen d-flex flex-column ga-4">
    <header class="console-home-screen__header">
      <div>
        <p class="text-overline text-medium-emphasis mb-1">Console</p>
        <h1 class="console-home-screen__title">Operations Console</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">Operator tools, scripts, and diagnostics.</p>
      </div>
      <v-btn color="primary" variant="flat" to="/home">Back to home</v-btn>
    </header>

    <v-sheet rounded="lg" border class="console-home-screen__panel">
      <div class="console-home-screen__status-row">
        <v-chip color="secondary" variant="tonal" label>Route: /console</v-chip>
        <v-chip color="info" variant="tonal" label>Surface status: enabled</v-chip>
      </div>
      <p class="text-body-2 text-medium-emphasis mb-0">
        Use this surface for operator actions and technical insights that should stay out of the end-user app.
      </p>
    </v-sheet>
  </section>
</template>

<style scoped>
.console-home-screen__header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.console-home-screen__title {
  font-size: clamp(1.5rem, 2.5vw, 2.25rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0 0 0.4rem;
}

.console-home-screen__panel {
  display: grid;
  gap: 1rem;
  padding: 1rem;
}

.console-home-screen__status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 640px) {
  .console-home-screen__header {
    flex-direction: column;
  }

  .console-home-screen__header :deep(.v-btn) {
    min-height: 48px;
    width: 100%;
  }
}
</style>
