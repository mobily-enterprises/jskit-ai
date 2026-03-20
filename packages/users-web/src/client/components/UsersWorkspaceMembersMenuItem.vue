<script setup>
import { computed } from "vue";
import { useSurfaceRouteContext } from "../composables/useSurfaceRouteContext.js";
import { mdiAccountGroupOutline } from "@mdi/js";
import { hasPermission, normalizePermissionList } from "../lib/permissions.js";
import { usePaths } from "../composables/usePaths.js";

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
    default: mdiAccountGroupOutline
  },
  surface: {
    type: String,
    default: "*"
  }
});

const { placementContext, currentSurfaceId } = useSurfaceRouteContext();
const paths = usePaths();

const canViewMembers = computed(() => {
  const permissions = normalizePermissionList(placementContext.value?.permissions);
  return hasPermission(permissions, "workspace.members.view") || hasPermission(permissions, "workspace.members.manage");
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

  return paths.page("/members", {
    surface: targetSurfaceId,
    mode: "auto"
  });
});
</script>

<template>
  <v-list-item
    v-if="canViewMembers && resolvedTo"
    :title="props.label"
    :to="resolvedTo"
    :prepend-icon="props.icon"
  />
</template>
