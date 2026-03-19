<script setup>
import { computed } from "vue";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { resolveProfileSurfaceMenuLinks } from "../lib/profileSurfaceMenuLinks.js";

const props = defineProps({
  surface: {
    type: String,
    default: "*"
  }
});

const { context: placementContext } = useWebPlacementContext();

const resolvedLinks = computed(() => {
  return resolveProfileSurfaceMenuLinks({
    context: placementContext.value,
    surface: props.surface
  });
});
</script>

<template>
  <v-list-item
    v-for="link in resolvedLinks"
    :key="link.id"
    :title="link.label"
    :to="link.to"
    :prepend-icon="link.icon"
  />
</template>
