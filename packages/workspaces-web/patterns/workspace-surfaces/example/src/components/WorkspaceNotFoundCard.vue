<script setup>
import { mdiAlertCircleOutline } from "@mdi/js";
import { computed } from "vue";

const props = defineProps({
  surfaceLabel: {
    type: String,
    default: "Workspace"
  },
  message: {
    type: String,
    default: "Workspace is currently unavailable."
  }
});

const normalizedSurfaceLabel = computed(() => String(props.surfaceLabel || "").trim() || "Workspace");
const normalizedMessage = computed(() => String(props.message || "").trim() || "Workspace is currently unavailable.");
</script>

<template>
  <v-sheet rounded="lg" border class="workspace-unavailable-panel">
    <div class="workspace-unavailable-panel__status">
      <v-icon :icon="mdiAlertCircleOutline" color="error" />
      <p class="text-body-2 text-medium-emphasis mb-0">{{ normalizedSurfaceLabel }} surface unavailable.</p>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-0">{{ normalizedMessage }}</p>
  </v-sheet>
</template>

<style scoped>
.workspace-unavailable-panel {
  display: grid;
  gap: 1rem;
  padding: 1rem;
}

.workspace-unavailable-panel__status {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
}
</style>
