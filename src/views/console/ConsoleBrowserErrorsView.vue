<template>
  <section class="console-errors-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-title class="d-flex flex-wrap align-center ga-3">
        <span class="text-subtitle-1 font-weight-bold">Browser errors</span>
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
      </v-card-title>
      <v-divider />
      <v-card-text>
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
              </tr>
            </thead>
            <tbody>
              <tr v-if="!state.entries.length">
                <td colspan="6" class="text-center text-medium-emphasis py-6">No browser errors captured.</td>
              </tr>
              <tr v-for="entry in state.entries" :key="entry.id">
                <td>{{ meta.formatDateTime(entry.createdAt) }}</td>
                <td>
                  <v-chip size="small" label>{{ entry.surface || "unknown" }}</v-chip>
                </td>
                <td>{{ entry.source || "window.error" }}</td>
                <td class="error-message-cell">
                  {{ meta.summarizeBrowserMessage(entry) }}
                </td>
                <td>{{ meta.formatLocation(entry) }}</td>
                <td>{{ entry.username || (entry.userId ? `#${entry.userId}` : "anonymous") }}</td>
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
import { useConsoleBrowserErrorsView } from "./useConsoleBrowserErrorsView.js";

const { meta, state, actions } = useConsoleBrowserErrorsView();
</script>

<style scoped>
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
</style>
