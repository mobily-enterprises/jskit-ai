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
import { readViewportWidth, resolveShellLayoutClass } from "../support/shellLayoutClass.js";
import { useJskitText } from "../i18n.js";

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

const { text } = useJskitText();
const TRANSLATED_PLACEMENT_PROPS = Object.freeze(["label", "title"]);

function isPlacementText(value) {
  return typeof value === "string" || (Boolean(value) && typeof value === "object" && typeof value.key === "string");
}

// A placement's label and title may be message keys or { key, fallback }; they
// reach the component in the active language. Plain text passes unchanged.
function placementProps(entry) {
  const source = entry?.props;
  if (!source || typeof source !== "object") {
    return source;
  }
  const translated = { ...source };
  for (const name of TRANSLATED_PLACEMENT_PROPS) {
    if (isPlacementText(source[name])) {
      translated[name] = text(source[name]);
    }
  }
  return translated;
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

const resolvedLayoutClass = computed(() => resolveShellLayoutClass(display?.name?.value, readViewportWidth()));

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
    v-bind="placementProps(entry)"
  />
</template>
