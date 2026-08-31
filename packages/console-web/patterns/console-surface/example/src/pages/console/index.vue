<template>
  <section class="console-home-screen d-flex flex-column ga-4">
    <div class="console-home-screen__actions">
      <v-btn color="primary" variant="flat" to="/home">Back to home</v-btn>
    </div>

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
.console-home-screen__actions {
  display: flex;
  justify-content: flex-end;
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
  .console-home-screen__actions :deep(.v-btn) {
    min-height: 48px;
    width: 100%;
  }
}
</style>
