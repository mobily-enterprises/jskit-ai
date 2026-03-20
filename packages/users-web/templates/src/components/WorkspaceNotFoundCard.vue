<script setup>
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
  <v-card rounded="lg" elevation="1" border>
    <v-card-item>
      <template #prepend>
        <v-icon icon="mdi-alert-circle-outline" color="error" />
      </template>
      <v-card-title class="text-h5">Unavailable</v-card-title>
      <v-card-subtitle>{{ normalizedSurfaceLabel }} surface.</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text class="d-flex flex-column ga-4">
      <p class="text-medium-emphasis mb-0">{{ normalizedMessage }}</p>
    </v-card-text>
  </v-card>
</template>
