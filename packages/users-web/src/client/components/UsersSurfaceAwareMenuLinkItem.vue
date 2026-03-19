<script setup>
import { computed } from "vue";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { usePaths } from "../composables/usePaths.js";
import { surfaceRequiresWorkspaceFromPlacementContext } from "../lib/workspaceSurfaceContext.js";

const props = defineProps({
  label: {
    type: String,
    default: ""
  },
  to: {
    type: String,
    default: ""
  },
  icon: {
    type: String,
    default: ""
  },
  surface: {
    type: String,
    default: ""
  },
  workspaceSuffix: {
    type: String,
    default: "/"
  },
  nonWorkspaceSuffix: {
    type: String,
    default: "/"
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const paths = usePaths();
const { context: placementContext } = useWebPlacementContext();

const targetSurfaceId = computed(() => {
  const explicitSurface = String(props.surface || "").trim().toLowerCase();
  if (explicitSurface && explicitSurface !== "*") {
    return explicitSurface;
  }

  return String(paths.currentSurfaceId.value || "").trim().toLowerCase();
});

const resolvedTo = computed(() => {
  const explicitTo = String(props.to || "").trim();
  if (explicitTo) {
    return explicitTo;
  }

  const workspaceRequired = surfaceRequiresWorkspaceFromPlacementContext(
    placementContext.value,
    targetSurfaceId.value
  );
  const suffix = workspaceRequired ? props.workspaceSuffix : props.nonWorkspaceSuffix;
  const normalizedSuffix = String(suffix || "/").trim() || "/";

  return paths.page(normalizedSuffix, {
    surface: targetSurfaceId.value,
    mode: "auto"
  });
});
</script>

<template>
  <v-list-item
    v-if="resolvedTo"
    :title="props.label"
    :to="resolvedTo"
    :prepend-icon="props.icon"
    :disabled="props.disabled"
  />
</template>
