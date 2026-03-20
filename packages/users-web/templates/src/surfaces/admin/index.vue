<script setup>
import WorkspaceNotFoundCard from "@/components/WorkspaceNotFoundCard.vue";
import { useWorkspaceNotFoundState } from "@/composables/useWorkspaceNotFoundState";

const { workspaceNotFound } = useWorkspaceNotFoundState();
</script>

<template>
  <WorkspaceNotFoundCard
    v-if="workspaceNotFound"
    surface-label="Admin"
    message="The requested workspace was not found."
  />
  <v-card v-else rounded="lg" elevation="1" border>
    <v-card-item>
      <template #prepend>
        <v-chip color="primary" size="small" label>Admin</v-chip>
      </template>
      <v-card-title class="text-h5">Workspace Admin</v-card-title>
      <v-card-subtitle>Privileged workspace workflows.</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text class="d-flex flex-column ga-4">
      <p class="text-medium-emphasis mb-0">
        Use this area for workspace administration modules.
      </p>
    </v-card-text>
  </v-card>
</template>
