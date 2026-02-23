<template>
  <section class="projects-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-title class="d-flex flex-wrap align-center ga-3">
        <span class="text-subtitle-1 font-weight-bold">Project details</span>
        <v-spacer />
        <v-btn variant="outlined" :loading="state.loading" @click="actions.refresh">Refresh</v-btn>
        <v-btn variant="outlined" @click="actions.goBack">Back to list</v-btn>
        <v-btn color="primary" :disabled="!state.projectId" @click="actions.goToEdit">Edit</v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text>
        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <div v-if="state.loading && !state.project" class="text-body-2 text-medium-emphasis">Loading project...</div>

        <template v-else-if="state.project">
          <v-row>
            <v-col cols="12" md="8">
              <p class="text-h6 mb-2">{{ state.project.name }}</p>
              <v-chip size="small" label class="mb-4">{{ projectStatusLabel(state.project.status) }}</v-chip>
              <p class="text-body-2 mb-2"><strong>Owner:</strong> {{ state.project.owner || "Unassigned" }}</p>
              <p class="text-body-2 mb-2"><strong>Created:</strong> {{ formatProjectDate(state.project.createdAt) }}</p>
              <p class="text-body-2 mb-4"><strong>Updated:</strong> {{ formatProjectDate(state.project.updatedAt) }}</p>
              <p class="text-body-1 mb-0">{{ state.project.notes || "No notes yet." }}</p>
            </v-col>
          </v-row>
        </template>

        <div v-else class="text-body-2 text-medium-emphasis">Project not found.</div>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useProjectsView } from "./useProjectsView";
import { formatProjectDate, projectStatusLabel } from "../../features/projects/presentation";

const { state, actions } = useProjectsView();
</script>
