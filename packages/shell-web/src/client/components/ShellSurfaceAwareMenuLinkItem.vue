<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { resolveShellLinkPath } from "../navigation/linkResolver.js";
import {
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceNavigationTargetFromPlacementContext,
  useWebPlacementContext
} from "../placement/index.js";
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
  },
  exact: {
    type: Boolean,
    default: false
  }
});

const route = useRoute();
const { context: placementContext } = useWebPlacementContext();

const currentSurfaceId = computed(() => {
  return resolveSurfaceIdFromPlacementPathname(
    placementContext.value,
    String(route?.path || route?.fullPath || "").trim()
  );
});

const resolvedTo = computed(() => {
  return resolveMenuLinkTarget({
    to: props.to,
    surface: props.surface,
    currentSurfaceId: currentSurfaceId.value,
    placementContext: placementContext.value,
    workspaceSuffix: props.workspaceSuffix,
    nonWorkspaceSuffix: props.nonWorkspaceSuffix,
    routeParams: route.params || {},
    resolvePagePath(relativePath, options = {}) {
      return resolveShellLinkPath({
        context: placementContext.value,
        surface: options.surface,
        relativePath,
        params: route.params || {},
        strictParams: options.strictParams !== false
      });
    }
  });
});

const resolvedTarget = computed(() => {
  const target = String(resolvedTo.value || "").trim();
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
    to: resolvedTarget.value.href || resolvedTo.value
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
