<script setup>
// One of the top app bar's own items (an app's tools, status or avatar), from a top-right placement.
const props = defineProps({
  icon: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true
  }
});
</script>

<template>
  <v-btn :icon="props.icon" variant="text" color="on-surface-variant" :aria-label="props.label" data-testid="fixture-status" />
</template>
