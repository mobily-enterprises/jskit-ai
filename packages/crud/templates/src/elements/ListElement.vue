<template>
  <section class="crud-list-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">${option:namespace|plural|pascal|default(CrudRecords)}</v-card-title>
            <v-card-subtitle class="px-0">Manage ${option:namespace|plural|default(records)} in the admin surface.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="outlined" :loading="isLoading" @click="records.reload">Refresh</v-btn>
          <v-btn color="primary" :to="createPath || undefined">New ${option:namespace|singular|default(record)}</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
          {{ loadError }}
        </v-alert>

        <v-table density="comfortable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Surname</th>
              <th>Updated</th>
              <th class="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="items.length < 1">
              <td colspan="4" class="text-center py-6 text-medium-emphasis">No records yet.</td>
            </tr>
            <tr v-for="record in items" :key="record.id">
              <td>{{ record.name }}</td>
              <td>{{ record.surname }}</td>
              <td>{{ formatDateTime(record.updatedAt) }}</td>
              <td class="text-right">
                <v-btn size="small" variant="text" :to="crudContext.resolveViewPath(record.id) || undefined">
                  Open
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-table>

        <div v-if="hasMore" class="d-flex justify-center pt-4">
          <v-btn variant="text" :loading="isLoadingMore" @click="records.loadMore">Load more</v-btn>
        </div>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { useCrudClientContext } from "./clientSupport.js";

const crudContext = useCrudClientContext();
const crudConfig = crudContext.crudConfig;
const createPath = crudContext.createPath;

const records = useList({
  visibility: crudConfig.visibility,
  apiSuffix: crudConfig.relativePath,
  queryKeyFactory: (surfaceId = "") => crudContext.listQueryKey(surfaceId),
  fallbackLoadError: "Unable to load records."
});

const items = records.items;
const loadError = records.loadError;
const isLoading = records.isLoading;
const hasMore = records.hasMore;
const isLoadingMore = records.isLoadingMore;

function formatDateTime(value) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "unknown";
  }

  return parsedDate.toLocaleString();
}
</script>
