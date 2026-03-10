<script setup>
import { watch } from "vue";
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { mdiCogOutline } from "@mdi/js";

const props = defineProps({
  surface: {
    type: String,
    default: "*"
  }
});

watch(
  () => props.surface,
  (nextSurface) => {
    console.log("[users-web-debug] workspace-tools-widget", {
      surface: nextSurface
    });
  },
  { immediate: true }
);
</script>

<template>
  <v-menu location="bottom end" offset="10" eager>
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        icon
        variant="text"
        aria-label="Workspace tools"
      >
        <v-icon :icon="mdiCogOutline" />
      </v-btn>
    </template>

    <v-list min-width="220" density="comfortable" class="py-1">
      <ShellOutlet :surface="props.surface" placement="workspace.primary-menu" />
    </v-list>
  </v-menu>
</template>
