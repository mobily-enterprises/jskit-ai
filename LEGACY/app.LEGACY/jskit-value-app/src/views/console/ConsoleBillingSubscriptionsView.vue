<template>
  <v-container class="py-4">
    <v-card rounded="lg" border>
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">Subscriptions</v-card-title>
        <v-card-subtitle>Provider subscription projections linked to assignment records.</v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <v-alert v-if="queryError" type="error" variant="tonal" class="mb-3">{{ queryError }}</v-alert>
        <div v-if="queryPending" class="text-body-2 text-medium-emphasis">Loading subscriptions...</div>
        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th class="text-left">Subscription</th>
              <th class="text-left">Workspace</th>
              <th class="text-left">Plan</th>
              <th class="text-left">Status</th>
              <th class="text-left">Period end</th>
              <th class="text-left">Cancel at end</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.providerSubscriptionId">
              <td>{{ entry.providerSubscriptionId }}</td>
              <td>{{ entry.workspaceSlug || entry.workspaceId || "-" }}</td>
              <td>{{ entry.planCode || entry.planName || "-" }}</td>
              <td>{{ entry.status || "-" }}</td>
              <td>{{ formatDate(entry.currentPeriodEnd) }}</td>
              <td>{{ entry.cancelAtPeriodEnd ? "yes" : "no" }}</td>
            </tr>
            <tr v-if="entries.length < 1">
              <td colspan="6" class="text-medium-emphasis">No subscriptions found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { useConsoleBillingSubscriptionsView } from "./useConsoleBillingSubscriptionsView.js";

const { entries, queryPending, queryError, formatDate } = useConsoleBillingSubscriptionsView();
</script>
