<template>
  <section class="crud-list-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">${option:namespace|plural|pascal}</v-card-title>
            <v-card-subtitle class="px-0">Manage ${option:namespace|plural|default(records)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="outlined" :loading="isFetching" @click="records.reload">Refresh</v-btn>
          <v-btn color="primary" :to="createPath">New ${option:namespace|singular|default(record)}</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <template v-if="showListSkeleton">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </template>
        <template v-else>
          <v-progress-linear v-if="isRefetching" indeterminate class="mb-3" />

          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Text field</th>
                <th>Date field</th>
                <th>Number field</th>
                <th>Updated</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="items.length < 1">
                <td colspan="5" class="text-center py-6 text-medium-emphasis">No records yet.</td>
              </tr>
              <tr v-for="record in items" :key="record.id">
                <td>{{ record.textField }}</td>
                <td>{{ crudContext.formatDateTime(record.dateField) }}</td>
                <td>{{ record.numberField }}</td>
                <td>{{ crudContext.formatDateTime(record.updatedAt) }}</td>
                <td class="text-right">
                  <v-btn size="small" variant="text" :to="crudContext.resolveViewPath(record.id)">
                    Open
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>

          <div v-if="hasMore" class="d-flex justify-center pt-4">
            <v-btn variant="text" :loading="isLoadingMore" @click="records.loadMore">Load more</v-btn>
          </div>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { useCrudListRuntime, useCrudModulePolicyRuntime } from "./clientSupport.js";

const {
  crudContext,
  createPath,
  apiSuffix,
  listQueryKey
} = useCrudListRuntime();
const { ownershipFilter, surfaceId } = useCrudModulePolicyRuntime();

const records = useList({
  ownershipFilter,
  surfaceId,
  apiSuffix,
  queryKeyFactory: listQueryKey,
  fallbackLoadError: "Unable to load records."
});

const items = records.items;
const isLoading = records.isInitialLoading;
const isFetching = records.isFetching;
const isRefetching = records.isRefetching;
const hasMore = records.hasMore;
const isLoadingMore = records.isLoadingMore;
const showListSkeleton = computed(() => Boolean(isLoading.value && items.value.length < 1));
</script>
