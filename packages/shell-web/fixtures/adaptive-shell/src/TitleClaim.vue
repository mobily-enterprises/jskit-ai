<script setup>
import { useShellPageTitle } from "../../../src/client/composables/useShellPageTitle.js";

// A nested component that claims the app bar title while it lives.
const props = defineProps({
  title: {
    type: String,
    required: true
  }
});

useShellPageTitle(() => props.title);
</script>

<template>
  <p data-testid="fixture-title-claim">{{ props.title }}</p>
</template>
