<template>
  <v-container class="py-4">
    <v-card rounded="lg" border>
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">Purchases</v-card-title>
        <v-card-subtitle>Confirmed purchase ledger and operational status snapshots.</v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <v-alert v-if="queryError" type="error" variant="tonal" class="mb-3">{{ queryError }}</v-alert>
        <div v-if="queryPending" class="text-body-2 text-medium-emphasis">Loading purchases...</div>
        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th class="text-left">ID</th>
              <th class="text-left">Workspace</th>
              <th class="text-left">Kind</th>
              <th class="text-left">Status</th>
              <th class="text-left">Amount</th>
              <th class="text-left">Provider</th>
              <th class="text-left">Purchased</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.id">
              <td>{{ entry.id }}</td>
              <td>{{ entry.workspaceSlug || entry.workspaceId || "-" }}</td>
              <td>{{ entry.purchaseKind || "-" }}</td>
              <td>{{ entry.status || "-" }}</td>
              <td>{{ formatMoney(entry.amountMinor, entry.currency) }}</td>
              <td>{{ entry.provider || "-" }}</td>
              <td>{{ formatDate(entry.purchasedAt) }}</td>
            </tr>
            <tr v-if="entries.length < 1">
              <td colspan="7" class="text-medium-emphasis">No purchases found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { useConsoleBillingPurchasesView } from "./useConsoleBillingPurchasesView.js";

const { entries, queryPending, queryError, formatMoney, formatDate } = useConsoleBillingPurchasesView();
</script>
