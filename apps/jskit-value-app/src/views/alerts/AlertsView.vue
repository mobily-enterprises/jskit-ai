<template>
  <section class="alerts-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-title class="d-flex flex-wrap align-center ga-3">
        <span class="text-subtitle-1 font-weight-bold">Alerts</span>
        <v-chip size="small" color="error" label variant="flat">{{ state.unreadCount }} unread</v-chip>
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
        <v-btn variant="outlined" :loading="state.loading" @click="actions.refresh">Refresh</v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-alert v-if="state.error" type="error" variant="tonal" class="mb-3">
          {{ state.error }}
        </v-alert>

        <div class="alerts-table-wrap">
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Title</th>
                <th>Message</th>
                <th>Created</th>
                <th class="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="state.loading && !state.hasEntries">
                <td colspan="4" class="text-center text-medium-emphasis py-6">Loading alerts...</td>
              </tr>
              <tr v-else-if="!state.hasEntries">
                <td colspan="4" class="text-center text-medium-emphasis py-6">No alerts yet.</td>
              </tr>
              <tr
                v-for="entry in state.entries"
                :key="entry.id"
                class="alerts-row"
                tabindex="0"
                @click="actions.openAlert(entry)"
                @keyup.enter="actions.openAlert(entry)"
              >
                <td>{{ entry.title }}</td>
                <td>{{ entry.message || entry.type }}</td>
                <td>{{ meta.formatDateTime(entry.createdAt) }}</td>
                <td class="text-right">
                  <v-chip v-if="entry.isUnread" size="x-small" color="error" label>Unread</v-chip>
                  <v-chip v-else size="x-small" color="secondary" label variant="outlined">Read</v-chip>
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
import { useAlertsView } from "./useAlertsView.js";

const { meta, state, actions } = useAlertsView();
</script>

<style scoped>
.alerts-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(54, 66, 58, 0.14);
  border-radius: 12px;
  background-color: #fff;
}

.alerts-row {
  cursor: pointer;
}

.alerts-row:hover {
  background-color: rgba(var(--v-theme-primary), 0.08);
}
</style>

