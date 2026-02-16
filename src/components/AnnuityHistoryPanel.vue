<template>
  <v-card class="panel-card" rounded="lg" elevation="1" border>
    <v-card-title class="d-flex flex-wrap align-center ga-3">
      <span class="panel-title">History</span>
      <v-spacer />
      <v-select
        :model-value="pageSize"
        :items="pageSizeOptions"
        label="Rows"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 120px"
        @update:model-value="(value) => emit('page-size-change', value)"
      />
      <v-btn variant="outlined" :loading="loading" @click="emit('refresh')">Refresh</v-btn>
    </v-card-title>
    <v-divider />
    <v-card-text>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-3">
        {{ error }}
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
            <tr v-if="!entries.length">
              <td colspan="4" class="text-center text-medium-emphasis py-6">No calculations yet.</td>
            </tr>
            <tr v-for="entry in entries" :key="entry.id">
              <td>{{ formatDate(entry.createdAt) }}</td>
              <td>{{ typeLabel(entry) }}</td>
              <td>{{ inputSummary(entry) }}</td>
              <td>{{ formatCurrency(entry.value) }}</td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <div class="d-flex align-center justify-end ga-4 mt-4">
        <p class="text-body-2 text-medium-emphasis mb-0">Page {{ page }} of {{ totalPages }} ({{ total }} total)</p>
        <v-btn-group variant="outlined">
          <v-btn :disabled="page <= 1 || loading" @click="emit('previous-page')">Previous</v-btn>
          <v-btn :disabled="page >= totalPages || loading" @click="emit('next-page')">Next</v-btn>
        </v-btn-group>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup>
defineProps({
  pageSizeOptions: {
    type: Array,
    required: true
  },
  error: {
    type: String,
    default: ""
  },
  loading: {
    type: Boolean,
    default: false
  },
  entries: {
    type: Array,
    default: () => []
  },
  page: {
    type: Number,
    required: true
  },
  totalPages: {
    type: Number,
    required: true
  },
  total: {
    type: Number,
    required: true
  },
  pageSize: {
    type: Number,
    required: true
  },
  formatDate: {
    type: Function,
    required: true
  },
  typeLabel: {
    type: Function,
    required: true
  },
  inputSummary: {
    type: Function,
    required: true
  },
  formatCurrency: {
    type: Function,
    required: true
  }
});

const emit = defineEmits(["refresh", "previous-page", "next-page", "page-size-change"]);
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
