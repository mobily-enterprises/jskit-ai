import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import { useWebPlacementContext } from "../placement/inject.js";
import {
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname
} from "../placement/surfaceContext.js";
import {
  readDrawerDefaultOpenPreference,
  writeDrawerDefaultOpenPreference
} from "./shellLayoutDrawerPreference.js";

function toSurfaceLabel(surfaceId = "") {
  const normalizedSurfaceId = String(surfaceId || "").trim().toLowerCase();
  if (!normalizedSurfaceId) {
    return "Surface";
  }

  return normalizedSurfaceId
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

const drawerDefaultOpen = ref(readDrawerDefaultOpenPreference());
const drawerOpen = ref(drawerDefaultOpen.value);

function setDrawerDefaultOpen(open) {
  const normalized = Boolean(open);
  drawerDefaultOpen.value = normalized;
  drawerOpen.value = normalized;
  writeDrawerDefaultOpenPreference(normalized);
}

function useShellLayoutState(props = {}) {
  let route = null;
  try {
    route = useRoute();
  } catch {
    route = null;
  }

  const { context: placementContext } = useWebPlacementContext();

  function toggleDrawer() {
    drawerOpen.value = !drawerOpen.value;
  }

  const resolvedSurface = computed(() => {
    const explicitSurface = normalizeSurfaceId(props?.surface);
    if (explicitSurface) {
      return explicitSurface;
    }

    const pathname =
      String(route?.path || "").trim() ||
      (typeof window === "object" && window?.location?.pathname ? String(window.location.pathname).trim() : "/");
    const contextValue = placementContext?.value || null;
    const resolvedSurfaceFromPath = resolveSurfaceIdFromPlacementPathname(contextValue, pathname);
    if (resolvedSurfaceFromPath) {
      return resolvedSurfaceFromPath;
    }

    const surfaceConfig = readPlacementSurfaceConfig(contextValue);
    if (surfaceConfig.defaultSurfaceId) {
      return surfaceConfig.defaultSurfaceId;
    }

    return "surface";
  });

  const resolvedSurfaceLabel = computed(() => {
    const explicitLabel = String(props?.surfaceLabel || "").trim();
    if (explicitLabel) {
      return explicitLabel;
    }

    const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(
      placementContext?.value || null,
      resolvedSurface.value
    );
    const configuredLabel = String(surfaceDefinition?.label || "").trim();
    if (configuredLabel) {
      return configuredLabel;
    }

    return toSurfaceLabel(resolvedSurface.value);
  });

  return Object.freeze({
    drawerDefaultOpen,
    drawerOpen,
    setDrawerDefaultOpen,
    toggleDrawer,
    resolvedSurface,
    resolvedSurfaceLabel
  });
}

export { useShellLayoutState };
