<template>
  <section class="workspace-billing-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">Billing activity</v-card-title>
        <v-card-subtitle>User-friendly timeline for this workspace billing lifecycle.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text>
        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <div class="d-flex flex-wrap ga-3 align-center mb-3">
          <v-select
            :model-value="state.sourceFilter"
            :items="meta.sourceOptions"
            item-title="title"
            item-value="value"
            label="Source"
            density="compact"
            variant="outlined"
            hide-details
            class="filters-field"
            @update:model-value="(value) => (state.sourceFilter = String(value || ''))"
          />
          <v-text-field
            v-model="state.operationKeyFilter"
            label="Operation key"
            density="compact"
            variant="outlined"
            hide-details
            class="filters-field"
          />
          <v-text-field
            v-model="state.providerEventIdFilter"
            label="Provider event id"
            density="compact"
            variant="outlined"
            hide-details
            class="filters-field"
          />
          <v-select
            :model-value="state.pageSize"
            :items="meta.pageSizeOptions"
            label="Rows"
            density="compact"
            variant="outlined"
            hide-details
            class="filters-field"
            @update:model-value="actions.setPageSize"
          />
          <v-btn color="primary" :loading="state.loading" @click="actions.applyFilters">Apply</v-btn>
          <v-btn variant="outlined" :loading="state.loading" @click="actions.refresh">Refresh</v-btn>
        </div>

        <v-timeline v-if="state.entries.length" density="compact" side="end" class="billing-timeline">
          <v-timeline-item v-for="entry in state.entries" :key="entry.id" size="small" dot-color="primary" fill-dot>
            <template #opposite>
              <span class="text-caption text-medium-emphasis">{{ meta.formatDateTime(entry.occurredAt) }}</span>
            </template>
            <div class="d-flex align-center ga-2 mb-1">
              <strong class="text-body-2">{{ entry.title }}</strong>
              <v-chip size="x-small" label>{{ meta.toTitleCase(entry.status) || entry.status }}</v-chip>
            </div>
            <div class="text-body-2">{{ entry.description }}</div>
            <div class="text-caption text-medium-emphasis mt-1">
              <span v-if="entry.operationKey">operation_key: {{ entry.operationKey }}</span>
              <span v-if="entry.operationKey && entry.providerEventId"> • </span>
              <span v-if="entry.providerEventId">provider_event_id: {{ entry.providerEventId }}</span>
            </div>
          </v-timeline-item>
        </v-timeline>
        <div v-else class="text-body-2 text-medium-emphasis">No billing activity found for this workspace yet.</div>

        <div class="d-flex align-center justify-space-between mt-3">
          <span class="text-body-2 text-medium-emphasis">Page {{ state.page }}</span>
          <div class="d-flex ga-2">
            <v-btn variant="outlined" :disabled="state.page <= 1 || state.loading" @click="actions.goPreviousPage">
              Previous
            </v-btn>
            <v-btn variant="outlined" :disabled="!state.hasMore || state.loading" @click="actions.goNextPage">
              Next
            </v-btn>
          </div>
        </div>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useWorkspaceBillingView } from "./useWorkspaceBillingView.js";

const { meta, state, actions } = useWorkspaceBillingView();
</script>

<style scoped>
.filters-field {
  min-width: 150px;
  max-width: 220px;
}

.billing-timeline {
  max-height: 560px;
  overflow-y: auto;
}
</style>
