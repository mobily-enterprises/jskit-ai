<script setup>
import { mdiAccountGroupOutline } from "@mdi/js";
import WorkspacePermissionMenuItem from "./WorkspacePermissionMenuItem.vue";
import { useJskitText } from "../i18n.js";

const props = defineProps({
  label: {
    type: String,
    default: "jskit.workspaces.menu.members"
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

const { text } = useJskitText();
const MEMBERS_MENU_PERMISSIONS = Object.freeze(["workspace.members.view", "workspace.members.manage"]);
</script>

<template>
  <WorkspacePermissionMenuItem
    :label="text(props.label)"
    :to="props.to"
    :icon="props.icon"
    :surface="props.surface"
    path="/members"
    :permissions="MEMBERS_MENU_PERMISSIONS"
  />
</template>
