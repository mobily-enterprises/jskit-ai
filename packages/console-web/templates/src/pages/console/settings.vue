<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { RouterView } from "vue-router";
</script>

<template>
  <section class="settings-shell d-flex flex-column ga-4">
    <header>
      <p class="text-overline text-medium-emphasis mb-1">Console</p>
      <h1 class="settings-shell__title">Console settings</h1>
      <p class="text-body-2 text-medium-emphasis mb-0">Global configuration and reference data for the whole app.</p>
    </header>

    <v-sheet rounded="lg" border class="settings-shell__panel">
      <nav class="settings-shell__nav" aria-label="Console settings sections">
        <v-list nav density="comfortable" class="settings-shell__nav-list">
          <ShellOutlet target="console-settings:primary-menu" />
        </v-list>
      </nav>
      <main class="settings-shell__content">
        <RouterView />
      </main>
    </v-sheet>
  </section>
</template>

<style scoped>
.settings-shell__title {
  font-size: clamp(1.35rem, 2vw, 1.85rem);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.35rem;
}

.settings-shell__panel {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
  padding: 1rem;
}

.settings-shell__nav-list {
  padding: 0;
}

.settings-shell__content {
  min-width: 0;
}

@media (max-width: 960px) {
  .settings-shell__panel {
    grid-template-columns: 1fr;
  }

  .settings-shell__nav {
    overflow-x: auto;
  }

  .settings-shell__nav-list {
    display: flex;
    gap: 0.5rem;
    min-width: max-content;
  }

  .settings-shell__nav-list :deep(.v-list-item) {
    min-height: 48px;
  }
}
</style>
