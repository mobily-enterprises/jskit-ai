<script setup>
import WorkspaceNotFoundCard from "@/components/WorkspaceNotFoundCard.vue";
import { useWorkspaceNotFoundState } from "@/composables/useWorkspaceNotFoundState";

const { workspaceUnavailable, workspaceUnavailableMessage } = useWorkspaceNotFoundState();
</script>

<template>
  <WorkspaceNotFoundCard
    v-if="workspaceUnavailable"
    :message="workspaceUnavailableMessage"
    surface-label="App"
  />
  <v-card v-else rounded="lg" elevation="1" border>
    <v-card-item>
      <template #prepend>
        <v-chip color="primary" size="small" label>App</v-chip>
      </template>
      <v-card-title class="text-h5">Workspace Home</v-card-title>
      <v-card-subtitle>Primary in-workspace surface.</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text class="d-flex flex-column ga-4">
      <p class="text-medium-emphasis mb-0">Replace this page with your workspace dashboard modules.</p>
    </v-card-text>
  </v-card>
</template>
