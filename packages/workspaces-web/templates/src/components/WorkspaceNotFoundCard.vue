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
    <div class="workspace-unavailable-panel__header">
      <v-icon :icon="mdiAlertCircleOutline" color="error" />
      <div>
        <h1 class="workspace-unavailable-panel__title">Unavailable</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">{{ normalizedSurfaceLabel }} surface.</p>
      </div>
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

.workspace-unavailable-panel__header {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
}

.workspace-unavailable-panel__title {
  font-size: clamp(1.35rem, 2vw, 1.85rem);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.25rem;
}
</style>
