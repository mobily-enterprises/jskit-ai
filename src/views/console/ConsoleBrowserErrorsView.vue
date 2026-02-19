<template>
  <section class="console-errors-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-title class="console-errors-title">
        <div class="title-row">
          <span class="text-subtitle-1 font-weight-bold">Browser errors</span>
        </div>
        <div class="actions-row">
          <v-select
            :model-value="state.pageSize"
            :items="meta.pageSizeOptions"
            label="Rows"
            density="compact"
            variant="outlined"
            hide-details
            class="rows-select"
            @update:model-value="actions.onPageSizeChange"
          />
          <v-btn color="error" variant="tonal" class="header-btn" @click="actions.simulateClientError">
            Simulate client error<span class="simulation-label"> ({{ meta.nextSimulationLabel }})</span>
          </v-btn>
          <v-btn variant="outlined" :loading="state.loading" class="header-btn" @click="actions.load">Refresh</v-btn>
        </div>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-alert v-if="state.simulationMessage" :type="state.simulationMessageType" variant="tonal" class="mb-3">
          {{ state.simulationMessage }}
        </v-alert>
        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <div class="errors-table-wrap">
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Captured</th>
                <th>Surface</th>
                <th>Source</th>
                <th>Message</th>
                <th>Location</th>
                <th>User</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!state.entries.length" class="empty-row">
                <td colspan="7" class="empty-cell text-center text-medium-emphasis py-6">No browser errors captured.</td>
              </tr>
              <tr v-for="entry in state.entries" :key="entry.id">
                <td data-label="Captured">{{ meta.formatDateTime(entry.createdAt) }}</td>
                <td data-label="Surface">
                  <v-chip size="small" label>{{ entry.surface || "unknown" }}</v-chip>
                </td>
                <td data-label="Source">{{ entry.source || "window.error" }}</td>
                <td data-label="Message" class="error-message-cell">
                  {{ meta.summarizeBrowserMessage(entry) }}
                </td>
                <td data-label="Location">{{ meta.formatLocation(entry) }}</td>
                <td data-label="User">{{ entry.username || (entry.userId ? `#${entry.userId}` : "anonymous") }}</td>
                <td data-label="Actions" class="actions-cell">
                  <v-btn size="small" variant="text" @click="actions.viewEntry(entry)">View</v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>

        <div class="pagination-row mt-4">
          <p class="text-body-2 text-medium-emphasis mb-2">Page {{ state.page }} of {{ state.totalPages }} ({{ state.total }} total)</p>
          <div class="pagination-actions">
            <v-btn variant="outlined" :disabled="state.page <= 1 || state.loading" @click="actions.goPrevious">
              Previous
            </v-btn>
            <v-btn variant="outlined" :disabled="state.page >= state.totalPages || state.loading" @click="actions.goNext">
              Next
            </v-btn>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useConsoleBrowserErrorsView } from "./useConsoleBrowserErrorsView.js";

const { meta, state, actions } = useConsoleBrowserErrorsView();
</script>

<style scoped>
.console-errors-title {
  display: grid;
  gap: 12px;
}

.title-row {
  display: flex;
  align-items: center;
}

.actions-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  justify-content: flex-end;
}

.rows-select {
  flex: 0 0 120px;
  max-width: 120px;
}

.header-btn {
  white-space: normal;
  text-transform: none;
}

.errors-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(54, 66, 58, 0.14);
  border-radius: 12px;
  background-color: #fff;
}

.error-message-cell {
  max-width: 420px;
  white-space: normal;
  word-break: break-word;
}

.pagination-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.pagination-actions {
  display: flex;
  gap: 8px;
}

.simulation-label {
  display: inline;
}

@media (max-width: 700px) {
  .actions-row {
    justify-content: stretch;
  }

  .rows-select {
    flex: 1 1 100%;
    max-width: none;
  }

  .header-btn {
    flex: 1 1 100%;
  }

  .simulation-label {
    display: none;
  }

  .errors-table-wrap {
    border: 0;
    background: transparent;
    overflow: visible;
  }

  .errors-table-wrap :deep(thead) {
    display: none;
  }

  .errors-table-wrap :deep(tbody tr) {
    display: block;
    border: 1px solid rgba(54, 66, 58, 0.14);
    border-radius: 12px;
    background: #fff;
    padding: 8px 0;
    margin-bottom: 10px;
  }

  .errors-table-wrap :deep(tbody tr.empty-row) {
    padding: 0;
    margin-bottom: 0;
  }

  .errors-table-wrap :deep(tbody td) {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 12px;
    white-space: normal;
  }

  .errors-table-wrap :deep(tbody td::before) {
    content: attr(data-label);
    flex: 0 0 78px;
    font-weight: 600;
    color: rgba(0, 0, 0, 0.7);
  }

  .errors-table-wrap :deep(tbody td.actions-cell) {
    justify-content: flex-end;
  }

  .errors-table-wrap :deep(tbody td.actions-cell::before) {
    display: none;
  }

  .empty-cell {
    display: block;
  }

  .empty-cell::before {
    display: none;
  }

  .pagination-row {
    display: grid;
    gap: 8px;
  }

  .pagination-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
}
</style>
