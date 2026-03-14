<script setup>
import {
  computed,
  watch
} from "vue";
import {
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { mdiCogOutline } from "@mdi/js";
import {
  hasPermission,
  normalizePermissionList
} from "../lib/permissions.js";
import { useUsersWebBootstrapQuery } from "../composables/useUsersWebBootstrapQuery.js";
import { useUsersPaths } from "../composables/useUsersPaths.js";

const props = defineProps({
  label: {
    type: String,
    default: "Workspace settings"
  },
  to: {
    type: String,
    default: ""
  },
  icon: {
    type: String,
    default: mdiCogOutline
  },
  surface: {
    type: String,
    default: "*"
  }
});

const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();
const paths = useUsersPaths();

function writeShellPermissions(permissionList) {
  mergePlacementContext(
    {
      permissions: permissionList
    },
    "users-web.workspace-settings-menu"
  );
}

const bootstrapQuery = useUsersWebBootstrapQuery({
  workspaceSlug: paths.workspaceSlug,
  enabled: true
});

const permissions = computed(() => {
  const shellPermissions = normalizePermissionList(placementContext.value?.permissions);
  if (shellPermissions.length > 0) {
    return shellPermissions;
  }
  return normalizePermissionList(bootstrapQuery.query.data.value?.permissions);
});

const canViewWorkspaceSettings = computed(() => {
  return (
    hasPermission(permissions.value || [], "workspace.settings.view") ||
    hasPermission(permissions.value || [], "workspace.settings.update")
  );
});

const resolvedTo = computed(() => {
  return paths.page("/workspace/settings", {
    surface: props.surface,
    explicitTo: props.to,
    mode: "auto"
  });
});

watch(
  () => bootstrapQuery.query.data.value?.permissions,
  (nextValue) => {
    const normalized = normalizePermissionList(nextValue);
    if (normalized.length > 0) {
      writeShellPermissions(normalized);
    }
  }
);

watch(
  () => placementContext.value?.workspace?.slug,
  () => {
    void bootstrapQuery.query.refetch();
  }
);
</script>

<template>
  <v-list-item
    v-if="canViewWorkspaceSettings && resolvedTo"
    :title="props.label || undefined"
    :to="resolvedTo || undefined"
    :prepend-icon="props.icon || undefined"
  />
</template>
