<script setup>
import { mdiCogOutline } from "@mdi/js";
import WorkspacePermissionMenuItem from "./WorkspacePermissionMenuItem.vue";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  label: {
    type: String,
    default: "jskit.workspaces.menu.workspaceSettings"
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

const { text } = useJskitText();
const WORKSPACE_SETTINGS_MENU_PERMISSIONS = Object.freeze([
  "workspace.settings.view",
  "workspace.settings.update"
]);
</script>

<template>
  <WorkspacePermissionMenuItem
    :label="text(props.label)"
    :to="props.to"
    :icon="props.icon"
    :surface="props.surface"
    path="/workspace/settings"
    :permissions="WORKSPACE_SETTINGS_MENU_PERMISSIONS"
  />
</template>
