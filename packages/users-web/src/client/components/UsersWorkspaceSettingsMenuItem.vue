<script setup>
import {
  computed,
  onMounted,
  ref,
  watch
} from "vue";
import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import {
  hasPermission,
  normalizePermissionList
} from "../lib/permissions.js";

const props = defineProps({
  label: {
    type: String,
    default: "Workspace settings"
  },
  to: {
    type: String,
    default: "/admin/workspace/settings"
  },
  icon: {
    type: String,
    default: "$menuSettings"
  }
});

const client = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

const permissions = ref([]);
const loadingPermissions = ref(false);
const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();

function readShellPermissions() {
  const context = placementContext.value;
  if (!context || typeof context !== "object") {
    return [];
  }

  return normalizePermissionList(context.permissions);
}

function writeShellPermissions(permissionList) {
  mergePlacementContext(
    {
      permissions: permissionList
    },
    "users-web.workspace-settings-menu"
  );
}

const canViewWorkspaceSettings = computed(() => {
  return (
    hasPermission(permissions.value, "workspace.settings.view") ||
    hasPermission(permissions.value, "workspace.settings.update")
  );
});

async function loadPermissions() {
  if (loadingPermissions.value) {
    return;
  }
  const fromShell = readShellPermissions();
  if (fromShell.length > 0) {
    permissions.value = fromShell;
    return;
  }

  loadingPermissions.value = true;
  try {
    const payload = await client.request("/api/bootstrap", {
      method: "GET"
    });
    const normalized = normalizePermissionList(payload?.permissions);
    permissions.value = normalized;
    writeShellPermissions(normalized);
  } catch {
    permissions.value = [];
  } finally {
    loadingPermissions.value = false;
  }
}

watch(
  () => placementContext.value?.permissions,
  (nextValue) => {
    const nextPermissions = normalizePermissionList(nextValue);
    if (nextPermissions.length > 0 || permissions.value.length < 1) {
      permissions.value = nextPermissions;
    }
  },
  {
    immediate: true
  }
);

onMounted(() => {
  void loadPermissions();
});
</script>

<template>
  <v-list-item
    v-if="canViewWorkspaceSettings"
    :title="props.label || undefined"
    :to="props.to || undefined"
    :prepend-icon="props.icon || undefined"
  />
</template>
