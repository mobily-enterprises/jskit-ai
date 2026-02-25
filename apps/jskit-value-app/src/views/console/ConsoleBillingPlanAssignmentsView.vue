<template>
  <v-container class="py-4">
    <v-card rounded="lg" border>
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">Plan assignments</v-card-title>
        <v-card-subtitle>Current and upcoming plan assignment records across billable entities.</v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <v-alert v-if="queryError" type="error" variant="tonal" class="mb-3">{{ queryError }}</v-alert>
        <div v-if="queryPending" class="text-body-2 text-medium-emphasis">Loading plan assignments...</div>
        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th class="text-left">ID</th>
              <th class="text-left">Workspace</th>
              <th class="text-left">Plan</th>
              <th class="text-left">Status</th>
              <th class="text-left">Start</th>
              <th class="text-left">End</th>
              <th class="text-left">Provider sub</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.id">
              <td>{{ entry.id }}</td>
              <td>{{ entry.workspaceSlug || entry.workspaceId || "-" }}</td>
              <td>{{ entry.planCode || entry.planName || "-" }}</td>
              <td>{{ entry.status || "-" }}</td>
              <td>{{ formatDate(entry.periodStartAt) }}</td>
              <td>{{ formatDate(entry.periodEndAt) }}</td>
              <td>{{ entry.providerSubscriptionId || "-" }}</td>
            </tr>
            <tr v-if="entries.length < 1">
              <td colspan="7" class="text-medium-emphasis">No plan assignments found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../platform/http/api/index.js";

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

const query = useQuery({
  queryKey: ["console", "billing", "plan-assignments"],
  queryFn: () =>
    api.console.listPlanAssignments({
      page: 1,
      pageSize: 50
    })
});

const entries = computed(() => {
  const value = Array.isArray(query.data.value?.entries) ? query.data.value.entries : [];
  return value;
});
const queryPending = computed(() => Boolean(query.isPending.value || query.isFetching.value));
const queryError = computed(() => String(query.error.value?.message || ""));
</script>
