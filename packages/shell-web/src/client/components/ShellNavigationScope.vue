<script setup>
import { provide, toRef } from "vue";
import { SHELL_NAVIGATION_PRESENTATION_KEY } from "../support/navigationPresentation.js";

// Tells the navigation items inside it how to present: as a "rail" or a "drawer".
const props = defineProps({
  presentation: {
    type: String,
    default: "drawer"
  }
});

provide(SHELL_NAVIGATION_PRESENTATION_KEY, toRef(props, "presentation"));
</script>

<template>
  <slot />
</template>
