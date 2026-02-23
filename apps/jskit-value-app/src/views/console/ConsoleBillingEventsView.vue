<template>
  <section class="console-billing-events-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">Billing events</v-card-title>
        <v-card-subtitle>Technical billing activity explorer across workspaces and billable entities.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text>
        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <div class="d-flex flex-wrap ga-3 align-center mb-3">
          <v-text-field
            v-model="state.workspaceSlugFilter"
            label="Workspace handle"
            density="compact"
            variant="outlined"
            hide-details
            class="filters-field"
          />
          <v-text-field
            v-model="state.userIdFilter"
            label="User id"
            density="compact"
            variant="outlined"
            hide-details
            class="filters-field"
          />
          <v-text-field
            v-model="state.billableEntityIdFilter"
            label="Billable entity id"
            density="compact"
            variant="outlined"
            hide-details
            class="filters-field"
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

        <v-expansion-panels variant="accordion" class="events-panels">
          <v-expansion-panel v-for="entry in state.entries" :key="entry.id">
            <v-expansion-panel-title>
              <div class="panel-title">
                <strong>{{ meta.formatDateTime(entry.occurredAt) }}</strong>
                <v-chip size="x-small" label>{{ entry.source }}</v-chip>
                <v-chip size="x-small" label :color="entry.status === 'failed' ? 'error' : 'primary'" variant="tonal">
                  {{ entry.status }}
                </v-chip>
                <span class="text-caption text-medium-emphasis">
                  ws={{ entry.workspaceSlug || "-" }} entity={{ entry.billableEntityId || "-" }} user={{ entry.ownerUserId || "-" }}
                </span>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="text-body-2 mb-2">
                <div><strong>eventType:</strong> {{ entry.eventType }}</div>
                <div><strong>operation_key:</strong> {{ entry.operationKey || "-" }}</div>
                <div><strong>provider_event_id:</strong> {{ entry.providerEventId || "-" }}</div>
                <div><strong>provider:</strong> {{ entry.provider || "-" }}</div>
                <div><strong>message:</strong> {{ entry.message || "-" }}</div>
              </div>
              <v-sheet color="surface-variant" rounded="md" class="pa-3 code-sheet">
                <pre>{{ meta.stringifyDetails(entry.detailsJson) }}</pre>
              </v-sheet>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <div v-if="!state.entries.length" class="text-body-2 text-medium-emphasis mt-2">
          No billing events found for the selected filters.
        </div>

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
import { useConsoleBillingEventsView } from "./useConsoleBillingEventsView.js";

const { meta, state, actions } = useConsoleBillingEventsView();
</script>

<style scoped>
.filters-field {
  min-width: 140px;
  max-width: 220px;
}

.panel-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.events-panels {
  overflow: hidden;
}

.code-sheet pre {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  overflow-x: auto;
}
</style>
