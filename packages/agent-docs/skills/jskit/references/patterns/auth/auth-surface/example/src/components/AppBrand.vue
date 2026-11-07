<script setup>
// The app's identity on its sign-in, reset and sign-out screens. The auth views place it in their brand slot: a pane
// beside the card on wide windows, and a row above the card on phones (`compact`). It is the app's name as
// index.html's <title> spells it, so renaming the app renames both. It holds no heading: each screen's h1 is its own.
defineProps({
  compact: {
    type: Boolean,
    default: false
  }
});

const APP_NAME = "Reading Room";
</script>

<template>
  <div :class="compact ? 'text-title-medium' : 'text-title-large'" data-testid="app-brand">{{ APP_NAME }}</div>
</template>
