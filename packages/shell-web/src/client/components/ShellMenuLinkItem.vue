<script setup>
import { computed } from "vue";
import {
  resolveSurfaceNavigationTargetFromPlacementContext,
  useWebPlacementContext
} from "../placement/index.js";
import { resolveMenuLinkIcon } from "../lib/menuIcons.js";

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
  disabled: {
    type: Boolean,
    default: false
  },
  exact: {
    type: Boolean,
    default: false
  }
});

const { context: placementContext } = useWebPlacementContext();

const resolvedTarget = computed(() => {
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

const resolvedIcon = computed(() =>
  resolveMenuLinkIcon({
    icon: props.icon,
    label: props.label,
    to: resolvedTarget.value.href || props.to
  })
);
</script>

<template>
  <v-list-item
    v-if="resolvedTarget.href"
    :title="props.label"
    :to="resolvedTarget.sameOrigin ? resolvedTarget.href : undefined"
    :href="resolvedTarget.sameOrigin ? undefined : resolvedTarget.href"
    :prepend-icon="resolvedIcon || undefined"
    :disabled="props.disabled"
    :exact="props.exact"
  />
</template>
