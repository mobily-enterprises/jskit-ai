<script setup>
import { computed } from "vue";
import { useSurfaceRouteContext } from "../composables/useSurfaceRouteContext.js";
import { resolveProfileSurfaceMenuLinks } from "../lib/profileSurfaceMenuLinks.js";

const props = defineProps({
  surface: {
    type: String,
    default: "*"
  }
});

const { placementContext, currentSurfaceId } = useSurfaceRouteContext();

const resolvedSurfaceId = computed(() => {
  const explicitSurface = String(props.surface || "").trim().toLowerCase();
  if (explicitSurface && explicitSurface !== "*") {
    return explicitSurface;
  }
  return String(currentSurfaceId.value || "").trim().toLowerCase() || "*";
});

const resolvedLinks = computed(() => {
  return resolveProfileSurfaceMenuLinks({
    context: placementContext.value,
    surface: resolvedSurfaceId.value
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
