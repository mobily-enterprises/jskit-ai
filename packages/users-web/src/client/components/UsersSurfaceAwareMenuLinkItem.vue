<script setup>
import { computed } from "vue";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { resolveWorkspaceAwareMenuTarget } from "../lib/workspaceMenuTarget.js";

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

const { context: placementContext } = useWebPlacementContext();

const resolvedTo = computed(() => {
  return resolveWorkspaceAwareMenuTarget({
    context: placementContext.value,
    surface: props.surface,
    explicitTo: props.to,
    workspaceSuffix: props.workspaceSuffix,
    nonWorkspaceSuffix: props.nonWorkspaceSuffix
  });
});
</script>

<template>
  <v-list-item
    v-if="resolvedTo"
    :title="props.label || undefined"
    :to="resolvedTo || undefined"
    :prepend-icon="props.icon || undefined"
    :disabled="props.disabled"
  />
</template>
