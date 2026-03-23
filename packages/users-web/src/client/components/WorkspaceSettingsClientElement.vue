<template>
  <section class="workspace-settings-client-element">
    <WorkspaceProfileClientElement @saved="handleFormSaved" />
    <WorkspaceSettingsFieldsClientElement @saved="handleFormSaved" />
  </section>
</template>

<script setup>
import { computed, watch } from "vue";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useBootstrapQuery } from "../composables/useBootstrapQuery.js";
import { useWorkspaceRouteContext } from "../composables/useWorkspaceRouteContext.js";
import { findWorkspaceBySlug, normalizeWorkspaceList } from "../lib/bootstrap.js";
import { arePermissionListsEqual, normalizePermissionList } from "../lib/permissions.js";
import WorkspaceProfileClientElement from "./WorkspaceProfileClientElement.vue";
import WorkspaceSettingsFieldsClientElement from "./WorkspaceSettingsFieldsClientElement.vue";

const routeContext = useWorkspaceRouteContext();
const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();
const bootstrapQuery = useBootstrapQuery({
  workspaceSlug: routeContext.workspaceSlugFromRoute,
  enabled: computed(() => Boolean(routeContext.workspaceSlugFromRoute.value))
});

function toWorkspaceEntrySnapshot(entry = null) {
  if (!entry || typeof entry !== "object") {
    return "";
  }

  const normalizedEntry = normalizeWorkspaceList([entry])[0] || null;
  if (!normalizedEntry) {
    return "";
  }

  return JSON.stringify(normalizedEntry);
}

function toWorkspaceListSnapshot(list = []) {
  return JSON.stringify(normalizeWorkspaceList(list));
}

function toWorkspaceSettingsSnapshot(settings = null) {
  if (!settings || typeof settings !== "object") {
    return "";
  }

  return JSON.stringify(settings);
}

function applyShellWorkspaceContext(payload = {}) {
  const availableWorkspaces = normalizeWorkspaceList(payload?.workspaces);
  const currentWorkspace = findWorkspaceBySlug(
    availableWorkspaces,
    routeContext.workspaceSlugFromRoute.value
  );
  const permissions = normalizePermissionList(payload?.permissions);
  const currentContext =
    placementContext.value && typeof placementContext.value === "object"
      ? placementContext.value
      : {};
  const currentPermissions = normalizePermissionList(currentContext.permissions);
  const samePermissions = arePermissionListsEqual(permissions, currentPermissions);
  const sameWorkspace = toWorkspaceEntrySnapshot(currentContext.workspace) === toWorkspaceEntrySnapshot(currentWorkspace);
  const sameWorkspaces =
    toWorkspaceListSnapshot(currentContext.workspaces) === toWorkspaceListSnapshot(availableWorkspaces);
  const sameWorkspaceSettings =
    toWorkspaceSettingsSnapshot(currentContext.workspaceSettings) ===
    toWorkspaceSettingsSnapshot(payload?.workspaceSettings);

  if (samePermissions && sameWorkspace && sameWorkspaces && sameWorkspaceSettings) {
    return;
  }

  mergePlacementContext(
    {
      workspace: currentWorkspace,
      workspaceSettings:
        payload?.workspaceSettings && typeof payload.workspaceSettings === "object"
          ? payload.workspaceSettings
          : null,
      workspaces: availableWorkspaces,
      permissions
    },
    "users-web.workspace-settings-view"
  );
}

watch(
  () => bootstrapQuery.query.data.value,
  (payload) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    applyShellWorkspaceContext(payload);
  },
  { immediate: true }
);

async function handleFormSaved() {
  await bootstrapQuery.query.refetch();
}
</script>
