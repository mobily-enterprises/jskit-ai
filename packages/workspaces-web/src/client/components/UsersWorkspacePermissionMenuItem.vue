<script setup>
import { computed } from "vue";
import { useSurfaceRouteContext } from "@jskit-ai/users-web/client/composables/useSurfaceRouteContext";
import { hasPermission, normalizePermissionList } from "@jskit-ai/users-web/client/lib/permissions";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";

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
    default: "*"
  },
  path: {
    type: String,
    default: "/"
  },
  permissions: {
    type: [Array, String],
    default: () => []
  }
});

const { placementContext, currentSurfaceId } = useSurfaceRouteContext();
const paths = usePaths();

function normalizeRequiredPermissions(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }

  const normalized = String(value || "").trim();
  if (!normalized) {
    return [];
  }

  return [normalized];
}

const requiredPermissions = computed(() => normalizeRequiredPermissions(props.permissions));

const canView = computed(() => {
  if (requiredPermissions.value.length < 1) {
    return true;
  }

  const permissions = normalizePermissionList(placementContext.value?.permissions);
  return requiredPermissions.value.some((permission) => hasPermission(permissions, permission));
});

const resolvedTo = computed(() => {
  const explicitTo = String(props.to || "").trim();
  if (explicitTo) {
    return explicitTo;
  }

  const explicitSurface = String(props.surface || "").trim().toLowerCase();
  const targetSurfaceId =
    explicitSurface && explicitSurface !== "*"
      ? explicitSurface
      : String(currentSurfaceId.value || "").trim().toLowerCase();
  const targetPath = String(props.path || "/").trim() || "/";

  return paths.page(targetPath, {
    surface: targetSurfaceId
  });
});
</script>

<template>
  <v-list-item
    v-if="canView && resolvedTo"
    :title="props.label"
    :to="resolvedTo"
    :prepend-icon="props.icon || undefined"
  />
</template>
