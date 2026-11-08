<script setup>
import { onBeforeUnmount, onMounted } from "vue";

// One of the top app bar's own items (an app's tools, status or avatar), from a top-right placement. It counts its
// mounts and unmounts by label in window.__fixtureStatusLifecycle, so a test can tell it stays mounted wherever the
// bar puts it, and with `surface` it also draws a surface of its own elsewhere on the page, as an item that opens a
// panel or a floating button does.
const props = defineProps({
  icon: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true
  },
  surface: {
    type: Boolean,
    default: false
  }
});

function count(event) {
  const lifecycle = window.__fixtureStatusLifecycle || (window.__fixtureStatusLifecycle = {});
  const key = `${props.label} ${event}`;
  lifecycle[key] = (lifecycle[key] || 0) + 1;
}

onMounted(() => count("mounted"));
onBeforeUnmount(() => count("unmounted"));
</script>

<template>
  <v-btn :icon="props.icon" variant="text" color="on-surface-variant" :aria-label="props.label" data-testid="fixture-status" />
  <Teleport v-if="props.surface" to="body">
    <div class="fixture-status-surface" data-testid="fixture-status-surface">{{ props.label }}</div>
  </Teleport>
</template>

<style scoped>
.fixture-status-surface {
  background: rgb(var(--v-theme-surface-container-high));
  border-radius: 8px;
  inset-block-end: 96px;
  inset-inline-start: 16px;
  padding: 4px 8px;
  position: fixed;
  z-index: 1;
}
</style>
