import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import { useWebPlacementContext } from "../placement/inject.js";
import { resolveRuntimePathname } from "../placement/pathname.js";
import { useShellLayoutStore } from "../stores/useShellLayoutStore.js";
import {
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname
} from "../placement/surfaceContext.js";
import { useJskitText } from "../i18n.js";

const { t, text } = useJskitText();

function toSurfaceLabel(surfaceId = "") {
  const normalizedSurfaceId = String(surfaceId || "").trim().toLowerCase();
  if (!normalizedSurfaceId) {
    return t("jskit.shell.layout.surface");
  }

  return normalizedSurfaceId
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

/** @param {import("../types.js").ShellLayoutStateProps} [props] */
function useShellLayoutState(props = {}) {
  const shellLayoutStore = useShellLayoutStore();
  const {
    drawerDefaultOpen,
    drawerOpen,
    supportingContentOpen,
    supportingContentTitle
  } = storeToRefs(shellLayoutStore);
  const route = useRoute();
  const { context: placementContext } = useWebPlacementContext();

  function toggleDrawer() {
    shellLayoutStore.toggleDrawer();
  }

  const resolvedSurface = computed(() => {
    const explicitSurface = normalizeSurfaceId(props.surface);
    if (explicitSurface) {
      return explicitSurface;
    }

    const contextValue = placementContext.value;
    const resolvedSurfaceFromPath = resolveSurfaceIdFromPlacementPathname(contextValue, resolveRuntimePathname(route.path));
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
    // A surface label may be a message key; plain text shows as written.
    const explicitLabel = String(text(props.surfaceLabel) || "").trim();
    if (explicitLabel) {
      return explicitLabel;
    }

    const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(placementContext.value, resolvedSurface.value);
    const configuredLabel = String(text(surfaceDefinition?.label) || "").trim();
    if (configuredLabel) {
      return configuredLabel;
    }

    return toSurfaceLabel(resolvedSurface.value);
  });

  return {
    drawerDefaultOpen,
    drawerOpen,
    supportingContentOpen,
    supportingContentTitle,
    setDrawerDefaultOpen: shellLayoutStore.setDrawerDefaultOpen,
    setDrawerOpen: shellLayoutStore.setDrawerOpen,
    setSupportingContentOpen: shellLayoutStore.setSupportingContentOpen,
    openSupportingContent: shellLayoutStore.openSupportingContent,
    closeSupportingContent: shellLayoutStore.closeSupportingContent,
    toggleDrawer,
    resolvedSurface,
    resolvedSurfaceLabel
  };
}

export { useShellLayoutState };
