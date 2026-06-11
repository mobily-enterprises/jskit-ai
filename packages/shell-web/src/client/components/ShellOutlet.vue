<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";
import { useRoute } from "vue-router";
import { useDisplay } from "vuetify";
import { useWebPlacementContext, useWebPlacementRuntime } from "../placement/inject.js";
import { resolveRuntimePathname } from "../placement/pathname.js";
import {
  readPlacementSurfaceConfig,
  resolveSurfaceIdFromPlacementPathname
} from "../placement/surfaceContext.js";

const props = defineProps({
  target: {
    type: String,
    default: ""
  },
  default: {
    type: Boolean,
    default: false
  },
  context: {
    type: Object,
    default: () => ({})
  }
});

let route = null;
try {
  route = useRoute();
} catch {
  route = null;
}

let display = null;
try {
  display = useDisplay();
} catch {
  display = null;
}

const placementRuntime = useWebPlacementRuntime();
const { context: placementContext } = useWebPlacementContext();
const revision = ref(
  typeof placementRuntime.getRevision === "function" ? placementRuntime.getRevision() : 0
);
let unsubscribe = null;

onMounted(() => {
  if (typeof placementRuntime.subscribe !== "function") {
    return;
  }
  unsubscribe = placementRuntime.subscribe((event) => {
    const next = Number(event?.revision);
    revision.value = Number.isInteger(next) ? next : revision.value + 1;
  });
});

onBeforeUnmount(() => {
  if (typeof unsubscribe === "function") {
    unsubscribe();
    unsubscribe = null;
  }
});

const resolvedSurface = computed(() => {
  const contextValue = placementContext?.value || null;
  const pathname = resolveRuntimePathname(route?.path);
  const surfaceFromPathname = resolveSurfaceIdFromPlacementPathname(contextValue, pathname);
  if (surfaceFromPathname) {
    return surfaceFromPathname;
  }

  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  if (surfaceConfig.defaultSurfaceId) {
    return surfaceConfig.defaultSurfaceId;
  }
  return "*";
});

const resolvedTargetId = computed(() => {
  return String(props.target || "").trim();
});

const resolvedLayoutClass = computed(() => {
  const displayName = String(display?.name?.value || "").trim().toLowerCase();
  if (displayName === "xs" || displayName === "sm") {
    return "compact";
  }
  if (displayName === "md") {
    return "medium";
  }
  if (displayName === "lg" || displayName === "xl" || displayName === "xxl") {
    return "expanded";
  }

  const viewportWidth =
    typeof window === "object" && window?.innerWidth
      ? Number(window.innerWidth)
      : 0;
  if (viewportWidth > 0 && viewportWidth < 600) {
    return "compact";
  }
  if (viewportWidth > 0 && viewportWidth < 1280) {
    return "medium";
  }
  return "expanded";
});

const placements = computed(() => {
  void revision.value;
  return placementRuntime.getPlacements({
    surface: resolvedSurface.value,
    target: resolvedTargetId.value,
    layoutClass: resolvedLayoutClass.value,
    context: props.context
  });
});
</script>

<template>
  <component
    :is="entry.component"
    v-for="entry in placements"
    :key="entry.id"
    v-bind="entry.props"
  />
</template>
