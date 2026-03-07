<script setup>
import { computed } from "vue";
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
  zone: {
    type: String,
    default: ""
  },
  context: {
    type: Object,
    default: () => ({})
  }
});

const placementRuntime = useWebPlacementRuntime();

const placements = computed(() => {
  return placementRuntime.getPlacements({
    surface: props.surface,
    slot: props.placement || props.zone,
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
    :surface="surface"
    :placement="placement || zone"
    :placement-id="entry.id"
  />
</template>
