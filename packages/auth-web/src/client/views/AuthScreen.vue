<script setup>
import { computed, useSlots } from "vue";
import { useDisplay } from "vuetify";

// The screen every auth view fills: the whole window below the shell's banners, its card centred on wide windows
// and full-bleed on phones. The app's brand, when it gives one, is a pane beside the card on wide windows and a
// compact row above it on phones; the slot gets { compact } to tell them apart. The page's one h1 is the card's.
const slots = useSlots();
const { mobile: compact } = useDisplay({ mobileBreakpoint: 960 });
const hasBrand = computed(() => Boolean(slots.brand));
</script>

<template>
  <div
    class="auth-screen"
    :class="{ 'auth-screen--compact': compact, 'auth-screen--branded': hasBrand }"
    data-testid="auth-screen"
  >
    <aside v-if="hasBrand && !compact" class="auth-screen__brand-pane" data-testid="auth-brand-pane">
      <slot name="brand" :compact="false" />
    </aside>
    <div class="auth-screen__main">
      <div v-if="hasBrand && compact" class="auth-screen__brand-row" data-testid="auth-brand-row">
        <slot name="brand" :compact="true" />
      </div>
      <slot :compact="compact" />
    </div>
  </div>
</template>

<style scoped>
.auth-screen {
  /* Start below shell banners shown on a surface without an app bar. */
  --auth-screen-height: calc(100dvh - var(--shell-error-banners-inline-height, 0px));
  --auth-screen-top-inset: env(safe-area-inset-top, 0px);
  position: fixed;
  inset: var(--shell-error-banners-inline-height, 0px) 0 0;
  z-index: 1;
  display: flex;
  overflow-y: auto;
  background-color: rgb(var(--v-theme-surface-container));
}

/* Phones: the card is the screen, on the card's own surface, with the brand row above it. */
.auth-screen--compact {
  flex-direction: column;
  background-color: rgb(var(--v-theme-surface-container-low));
}

.auth-screen--compact.auth-screen--branded {
  --auth-screen-top-inset: 0px;
}

.auth-screen__brand-pane {
  display: flex;
  flex: 0.85 1 0;
  flex-direction: column;
  justify-content: space-between;
  gap: 32px;
  min-width: 18rem;
  min-height: var(--auth-screen-height);
  padding: 48px;
  background-color: rgb(var(--v-theme-primary-container));
  color: rgb(var(--v-theme-on-primary-container));
}

.auth-screen__main {
  display: flex;
  flex: 1.15 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: var(--auth-screen-height);
  padding: 32px 24px;
}

.auth-screen--compact .auth-screen__main {
  flex: 1 0 auto;
  align-items: stretch;
  justify-content: flex-start;
  padding: 0;
}

.auth-screen__brand-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: calc(16px + env(safe-area-inset-top, 0px)) 20px 0;
}

@media (min-width: 1280px) {
  .auth-screen__brand-pane {
    padding: 64px;
  }
}
</style>
