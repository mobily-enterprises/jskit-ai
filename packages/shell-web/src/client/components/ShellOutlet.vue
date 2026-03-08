<script setup>
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";
import { useWebPlacementRuntime } from "../placement/inject.js";

const props = defineProps({
  surface: {
    type: String,
    default: "*"
  },
  placement: {
    type: String,
    default: ""
  },
  context: {
    type: Object,
    default: () => ({})
  }
});

const placementRuntime = useWebPlacementRuntime();
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

const placements = computed(() => {
  void revision.value;
  const resolved = placementRuntime.getPlacements({
    surface: props.surface,
    slot: props.placement,
    context: props.context
  });
  console.log("[shell-outlet-debug] resolved placements", {
    surface: props.surface,
    placement: props.placement,
    count: resolved.length,
    ids: resolved.map((entry) => entry.id),
    context: props.context
  });
  return resolved;
});
</script>

<template>
  <component
    :is="entry.component"
    v-for="entry in placements"
    :key="entry.id"
    v-bind="entry.props"
    :surface="surface"
    :placement="placement"
    :placement-id="entry.id"
  />
</template>
