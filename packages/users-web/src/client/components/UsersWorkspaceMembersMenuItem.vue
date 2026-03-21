<script setup>
import { mdiAccountGroupOutline } from "@mdi/js";
import UsersWorkspacePermissionMenuItem from "./UsersWorkspacePermissionMenuItem.vue";

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

const MEMBERS_MENU_PERMISSIONS = Object.freeze(["workspace.members.view", "workspace.members.manage"]);
</script>

<template>
  <UsersWorkspacePermissionMenuItem
    :label="props.label"
    :to="props.to"
    :icon="props.icon"
    :surface="props.surface"
    path="/members"
    :permissions="MEMBERS_MENU_PERMISSIONS"
  />
</template>
