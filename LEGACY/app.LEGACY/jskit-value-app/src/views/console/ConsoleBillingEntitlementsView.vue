<template>
  <v-container class="py-4">
    <v-card rounded="lg" border>
      <v-card-item>
        <v-card-title class="text-subtitle-1 font-weight-bold">Entitlement definitions</v-card-title>
        <v-card-subtitle>Catalog-level entitlement definitions available to plans and products.</v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <v-alert v-if="queryError" type="error" variant="tonal" class="mb-3">{{ queryError }}</v-alert>
        <div v-if="queryPending" class="text-body-2 text-medium-emphasis">Loading entitlement definitions...</div>
        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th class="text-left">Code</th>
              <th class="text-left">Name</th>
              <th class="text-left">Type</th>
              <th class="text-left">Unit</th>
              <th class="text-left">Mode</th>
              <th class="text-left">Active</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.id">
              <td>{{ entry.code }}</td>
              <td>{{ entry.name }}</td>
              <td>{{ entry.entitlementType }}</td>
              <td>{{ entry.unit }}</td>
              <td>{{ entry.enforcementMode }}</td>
              <td>{{ entry.isActive ? "yes" : "no" }}</td>
            </tr>
            <tr v-if="entries.length < 1">
              <td colspan="6" class="text-medium-emphasis">No entitlement definitions found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { useConsoleBillingEntitlementsView } from "./useConsoleBillingEntitlementsView.js";

const { entries, queryPending, queryError } = useConsoleBillingEntitlementsView();
</script>
