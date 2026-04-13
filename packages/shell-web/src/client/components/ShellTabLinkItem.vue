<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { resolveShellLinkPath } from "../navigation/linkResolver.js";
import {
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceNavigationTargetFromPlacementContext,
  useWebPlacementContext
} from "../placement/index.js";
import {
  normalizeMenuLinkPathname,
  resolveMenuLinkTarget
} from "../support/menuLinkTarget.js";

const props = defineProps({
  label: {
    type: String,
    default: ""
  },
  to: {
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

const isActive = computed(() => {
  if (!resolvedTarget.value.sameOrigin) {
    return false;
  }

  const targetPath = normalizeMenuLinkPathname(resolvedTarget.value.href);
  const currentPath = normalizeMenuLinkPathname(route.fullPath || route.path || "");
  if (!targetPath || !currentPath) {
    return false;
  }

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
});
</script>

<template>
  <v-btn
    v-if="resolvedTarget.href"
    class="tab-link-item"
    variant="text"
    size="small"
    :to="resolvedTarget.sameOrigin ? resolvedTarget.href : undefined"
    :href="resolvedTarget.sameOrigin ? undefined : resolvedTarget.href"
    :active="isActive"
    :disabled="disabled"
    color="primary"
  >
    {{ label || "Tab" }}
  </v-btn>
</template>

<style scoped>
.tab-link-item {
  text-transform: none;
  font-weight: 600;
  border-radius: 999px;
}
</style>
