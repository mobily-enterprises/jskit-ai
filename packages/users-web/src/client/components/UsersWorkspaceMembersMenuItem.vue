<script setup>
import {
  computed,
  watch
} from "vue";
import {
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { resolveWorkspaceAwareMenuTarget } from "../lib/workspaceMenuTarget.js";
import {
  hasPermission,
  normalizePermissionList
} from "../lib/permissions.js";

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
    default: "mdi-account-group-outline"
  },
  surface: {
    type: String,
    default: "*"
  }
});

const { context: placementContext } = useWebPlacementContext();

const canViewMembers = computed(() => {
  const permissions = normalizePermissionList(placementContext.value?.permissions);
  return hasPermission(permissions, "workspace.members.view") || hasPermission(permissions, "workspace.members.manage");
});

const resolvedTo = computed(() => {
  const context = placementContext.value;
  return resolveWorkspaceAwareMenuTarget({
    context,
    surface: props.surface,
    explicitTo: props.to,
    workspaceSuffix: "/members",
    nonWorkspaceSuffix: "/members"
  });
});

watch(
  [() => normalizePermissionList(placementContext.value?.permissions), canViewMembers, resolvedTo],
  ([nextPermissions, nextCanViewMembers, nextResolvedTo]) => {
    console.log("[users-web-debug] workspace-members-menu-item", {
      surface: props.surface,
      permissions: nextPermissions,
      canViewMembers: nextCanViewMembers,
      resolvedTo: nextResolvedTo
    });
  },
  { immediate: true }
);
</script>

<template>
  <v-list-item
    v-if="canViewMembers && resolvedTo"
    :title="props.label || undefined"
    :to="resolvedTo || undefined"
    :prepend-icon="props.icon || undefined"
  />
</template>
