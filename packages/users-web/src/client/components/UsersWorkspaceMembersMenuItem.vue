<script setup>
import {
  computed
} from "vue";
import {
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { mdiAccountGroupOutline } from "@mdi/js";
import {
  hasPermission,
  normalizePermissionList
} from "../lib/permissions.js";
import { useUsersPaths } from "../composables/useUsersPaths.js";

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

const { context: placementContext } = useWebPlacementContext();
const paths = useUsersPaths();

const canViewMembers = computed(() => {
  const permissions = normalizePermissionList(placementContext.value?.permissions);
  return hasPermission(permissions, "workspace.members.view") || hasPermission(permissions, "workspace.members.manage");
});

const resolvedTo = computed(() => {
  return paths.page("/members", {
    surface: props.surface,
    explicitTo: props.to,
    mode: "auto"
  });
});
</script>

<template>
  <v-list-item
    v-if="canViewMembers && resolvedTo"
    :title="props.label || undefined"
    :to="resolvedTo || undefined"
    :prepend-icon="props.icon || undefined"
  />
</template>
