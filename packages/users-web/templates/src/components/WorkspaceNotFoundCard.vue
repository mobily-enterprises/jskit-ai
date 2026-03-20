<script setup>
import { computed } from "vue";

const props = defineProps({
  surfaceLabel: {
    type: String,
    default: "Workspace"
  },
  message: {
    type: String,
    default: "The requested workspace was not found."
  }
});

const normalizedSurfaceLabel = computed(() => String(props.surfaceLabel || "").trim() || "Workspace");
const normalizedMessage = computed(() => String(props.message || "").trim() || "The requested workspace was not found.");
</script>

<template>
  <v-card rounded="lg" elevation="1" border>
    <v-card-item>
      <template #prepend>
        <v-chip color="error" size="small" label>Not found</v-chip>
      </template>
      <v-card-title class="text-h5">Not found</v-card-title>
      <v-card-subtitle>{{ normalizedSurfaceLabel }} surface.</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text class="d-flex flex-column ga-4">
      <p class="text-medium-emphasis mb-0">{{ normalizedMessage }}</p>
    </v-card-text>
  </v-card>
</template>
