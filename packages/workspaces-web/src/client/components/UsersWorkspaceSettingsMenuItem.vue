<script setup>
import { mdiCogOutline } from "@mdi/js";
import UsersWorkspacePermissionMenuItem from "./UsersWorkspacePermissionMenuItem.vue";

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

const WORKSPACE_SETTINGS_MENU_PERMISSIONS = Object.freeze([
  "workspace.settings.view",
  "workspace.settings.update"
]);
</script>

<template>
  <UsersWorkspacePermissionMenuItem
    :label="props.label"
    :to="props.to"
    :icon="props.icon"
    :surface="props.surface"
    path="/workspace/settings"
    :permissions="WORKSPACE_SETTINGS_MENU_PERMISSIONS"
  />
</template>
