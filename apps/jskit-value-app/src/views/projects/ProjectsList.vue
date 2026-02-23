<template>
  <section class="projects-list-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-title class="d-flex flex-wrap align-center ga-3">
        <span class="text-subtitle-1 font-weight-bold">Projects</span>
        <v-spacer />
        <v-select
          :model-value="state.pageSize"
          :items="meta.pageSizeOptions"
          label="Rows"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 120px"
          @update:model-value="actions.onPageSizeChange"
        />
        <v-btn variant="outlined" :loading="state.loading" @click="actions.load">Refresh</v-btn>
        <v-btn color="primary" @click="actions.goToAdd">Add project</v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <div class="projects-table-wrap">
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Updated</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!state.entries.length">
                <td colspan="5" class="text-center text-medium-emphasis py-6">No projects yet.</td>
              </tr>
              <tr v-for="entry in state.entries" :key="entry.id">
                <td>{{ entry.name }}</td>
                <td>
                  <v-chip size="small" label>{{ projectStatusLabel(entry.status) }}</v-chip>
                </td>
                <td>{{ entry.owner || "Unassigned" }}</td>
                <td>{{ formatProjectDate(entry.updatedAt || entry.createdAt) }}</td>
                <td class="text-right">
                  <div class="d-inline-flex ga-2">
                    <v-btn size="small" variant="text" @click="actions.goToView(entry.id)">View</v-btn>
                    <v-btn size="small" variant="text" color="primary" @click="actions.goToEdit(entry.id)">Edit</v-btn>
                  </div>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>

        <div class="d-flex align-center justify-end ga-4 mt-4">
          <p class="text-body-2 text-medium-emphasis mb-0">
            Page {{ state.page }} of {{ state.totalPages }} ({{ state.total }} total)
          </p>
          <v-btn-group variant="outlined">
            <v-btn :disabled="state.page <= 1 || state.loading" @click="actions.goPrevious">Previous</v-btn>
            <v-btn :disabled="state.page >= state.totalPages || state.loading" @click="actions.goNext">Next</v-btn>
          </v-btn-group>
        </div>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useProjectsList } from "./useProjectsList";
import { formatProjectDate, projectStatusLabel } from "../../features/projects/presentation";

const { meta, state, actions } = useProjectsList();
</script>

<style scoped>
.projects-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(54, 66, 58, 0.14);
  border-radius: 12px;
  background-color: #fff;
}
</style>
