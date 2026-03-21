<script setup>
import { computed } from "vue";
import {
  useWebPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";

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
  }
});
const { context: placementContext } = useWebPlacementContext();

const resolvedNavigationTarget = computed(() => {
  const target = String(props.to || "").trim();
  if (!target) {
    return {
      href: "",
      sameOrigin: true
    };
  }

  const navigationTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext.value, {
    path: target
  });
  return {
    href: navigationTarget.href,
    sameOrigin: navigationTarget.sameOrigin
  };
});
</script>

<template>
  <v-list-item
    :title="props.label || undefined"
    :to="resolvedNavigationTarget.sameOrigin ? resolvedNavigationTarget.href || undefined : undefined"
    :href="resolvedNavigationTarget.sameOrigin ? undefined : resolvedNavigationTarget.href || undefined"
    :prepend-icon="props.icon || undefined"
  />
</template>
