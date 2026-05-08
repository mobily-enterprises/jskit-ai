<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { RouterView } from "vue-router";
</script>

<template>
  <section class="generated-ui-screen generated-ui-screen--settings settings-shell d-flex flex-column ga-4">
    <header>
      <p class="text-overline text-medium-emphasis mb-1">Settings</p>
      <h1 class="settings-shell__title">Home settings</h1>
      <p class="text-body-2 text-medium-emphasis mb-0">Configure shell behavior for this surface.</p>
    </header>

    <v-sheet rounded="lg" border class="settings-shell__panel">
      <div class="settings-shell__body">
        <nav class="settings-shell__nav" aria-label="Home settings sections">
          <v-list nav density="comfortable" rounded="lg" border>
            <ShellOutlet target="home-settings:primary-menu" />
          </v-list>
        </nav>

        <main class="settings-shell__content">
          <RouterView />
        </main>
      </div>
    </v-sheet>
  </section>
</template>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.35rem, 2vw, 1.85rem);
  --generated-ui-screen-panel-padding: 1rem;
}

.settings-shell__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.35rem;
}

.settings-shell__panel {
  overflow: hidden;
}

.settings-shell__body {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
  padding: var(--generated-ui-screen-panel-padding);
}

.settings-shell__content {
  min-width: 0;
}

@media (max-width: 960px) {
  .settings-shell__body {
    grid-template-columns: 1fr;
  }

  .settings-shell__nav :deep(.v-list) {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .settings-shell__nav :deep(.v-list-item) {
    flex: 0 0 auto;
    min-height: 48px;
  }
}
</style>
