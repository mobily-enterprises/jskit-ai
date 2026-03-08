<script setup>
import { computed } from "vue";
import {
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { resolveWorkspaceAwareMenuTarget } from "../lib/workspaceMenuTarget.js";

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
  const context = placementContext.value;
  return resolveWorkspaceAwareMenuTarget({
    context,
    surface: props.surface,
    explicitTo: props.to,
    workspaceSuffix: "/members",
    nonWorkspaceSuffix: "/members"
  });
});
</script>

<template>
  <v-list-item :title="props.label || undefined" :to="resolvedTo || undefined" :prepend-icon="props.icon || undefined" />
</template>
