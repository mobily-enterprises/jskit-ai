<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { usePaths } from "../composables/usePaths.js";
import { resolveMenuLinkIcon } from "../lib/menuIcons.js";
import { resolveMenuLinkTarget } from "../support/menuLinkTarget.js";

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

const route = useRoute();
const paths = usePaths();
const { context: placementContext } = useWebPlacementContext();

const resolvedTo = computed(() => {
  return resolveMenuLinkTarget({
    to: props.to,
    surface: props.surface,
    currentSurfaceId: paths.currentSurfaceId.value,
    placementContext: placementContext.value,
    workspaceSuffix: props.workspaceSuffix,
    nonWorkspaceSuffix: props.nonWorkspaceSuffix,
    routeParams: route.params || {},
    resolvePagePath(relativePath, options = {}) {
      return paths.page(relativePath, options);
    }
  });
});

const resolvedIcon = computed(() =>
  resolveMenuLinkIcon({
    icon: props.icon,
    label: props.label,
    to: resolvedTo.value
  })
);
</script>

<template>
  <v-list-item
    v-if="resolvedTo"
    :title="props.label"
    :to="resolvedTo"
    :prepend-icon="resolvedIcon || undefined"
    :disabled="props.disabled"
  />
</template>
