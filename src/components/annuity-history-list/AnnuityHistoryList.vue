<template>
  <v-card class="panel-card" rounded="lg" elevation="1" border>
    <v-card-title class="d-flex flex-wrap align-center ga-3">
      <span class="panel-title">History</span>
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

      <div class="history-table-wrap">
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Inputs</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!state.entries.length">
              <td colspan="4" class="text-center text-medium-emphasis py-6">No calculations yet.</td>
            </tr>
            <tr v-for="entry in state.entries" :key="entry.id">
              <td>{{ formatDate(entry.createdAt) }}</td>
              <td>{{ typeLabel(entry) }}</td>
              <td>{{ inputSummary(entry) }}</td>
              <td>{{ formatCurrency(entry.value) }}</td>
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
</template>

<script setup>
import { watch } from "vue";
import { formatCurrency, formatDate, inputSummary, typeLabel } from "../../features/annuity/presentation";
import { useAnnuityHistoryList } from "./useAnnuityHistoryList";

const props = defineProps({
  refreshToken: { type: Number, default: 0 },
  initialPageSize: { type: Number, default: undefined }
});

const { meta, state, actions } = useAnnuityHistoryList({
  initialPageSize: props.initialPageSize
});

watch(() => props.refreshToken, actions.onCalculationCreated);
</script>

<style scoped>
.panel-card {
  background-color: rgb(var(--v-theme-surface));
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.history-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(54, 66, 58, 0.14);
  border-radius: 12px;
  background-color: #fff;
}
</style>
