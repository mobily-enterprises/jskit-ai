<script setup>
import { computed } from "vue";
import { useWebPlacementContext, resolveSurfacePathFromPlacementContext } from "@jskit-ai/shell-web/client/placement";

const props = defineProps({
  label: {
    type: String,
    default: "Members"
  },
  to: {
    type: String,
    default: ""
  },
  icon: {
    type: String,
    default: "mdi-account-group-outline"
  },
  surface: {
    type: String,
    default: "*"
  }
});

const { context: placementContext } = useWebPlacementContext();

const resolvedTo = computed(() => {
  const explicitTarget = String(props.to || "").trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  return resolveSurfacePathFromPlacementContext(placementContext.value, props.surface, "/members");
});
</script>

<template>
  <v-list-item :title="props.label || undefined" :to="resolvedTo || undefined" :prepend-icon="props.icon || undefined" />
</template>
