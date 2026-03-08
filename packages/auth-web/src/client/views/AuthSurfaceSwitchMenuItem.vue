<script setup>
import { computed } from "vue";
import {
  useWebPlacementContext,
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";

const props = defineProps({
  surface: {
    type: String,
    default: "*"
  }
});

const { context: placementContext } = useWebPlacementContext();

const resolvedLink = computed(() => {
  const source = placementContext.value;
  const surfaceConfig = readPlacementSurfaceConfig(source);
  const currentSurface = resolveSurfaceDefinitionFromPlacementContext(source, props.surface);
  const currentSurfaceId = String(currentSurface?.id || "");
  const currentRequiresWorkspace = Boolean(currentSurface?.requiresWorkspace);

  const workspaceSurfaceId = surfaceConfig.enabledSurfaceIds.find(
    (surfaceId) => surfaceId !== currentSurfaceId && Boolean(surfaceConfig.surfacesById[surfaceId]?.requiresWorkspace)
  );
  const appSurfaceId = surfaceConfig.enabledSurfaceIds.find(
    (surfaceId) => surfaceId !== currentSurfaceId && !Boolean(surfaceConfig.surfacesById[surfaceId]?.requiresWorkspace)
  );

  if (currentRequiresWorkspace) {
    if (!appSurfaceId) {
      return null;
    }

    return {
      label: "Go to app",
      to: resolveSurfaceRootPathFromPlacementContext(source, appSurfaceId),
      icon: "mdi-open-in-new"
    };
  }

  if (!workspaceSurfaceId) {
    return null;
  }

  return {
    label: "Go to workspace",
    to: resolveSurfaceRootPathFromPlacementContext(source, workspaceSurfaceId),
    icon: "mdi-briefcase-outline"
  };
});
</script>

<template>
  <v-list-item
    v-if="resolvedLink"
    :title="resolvedLink.label"
    :to="resolvedLink.to"
    :prepend-icon="resolvedLink.icon"
  />
</template>
