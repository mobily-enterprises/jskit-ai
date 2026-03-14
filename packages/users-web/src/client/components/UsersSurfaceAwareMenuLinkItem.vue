<script setup>
import { computed } from "vue";
import { useUsersPaths } from "../composables/useUsersPaths.js";

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

const paths = useUsersPaths();

const resolvedTo = computed(() => {
  return paths.page("/", {
    surface: props.surface,
    explicitTo: props.to,
    mode: "auto",
    workspaceRelativePath: props.workspaceSuffix,
    surfaceRelativePath: props.nonWorkspaceSuffix
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
