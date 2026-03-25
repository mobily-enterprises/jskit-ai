<template>
  <section class="ui-generator-list-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">${option:namespace|plural|pascal}</v-card-title>
            <v-card-subtitle class="px-0">Generated list for ${option:namespace|plural|default(records)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="outlined" :loading="records.isFetching.value" @click="records.reload">Refresh</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <div v-if="records.loadError.value" class="text-body-2 text-error pb-4">{{ records.loadError.value }}</div>

        <template v-else-if="showListSkeleton">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </template>

        <template v-else>
          <v-progress-linear v-if="records.isRefetching.value" indeterminate class="mb-3" />

          <v-table density="comfortable">
            <thead>
              <tr>
__JSKIT_UI_LIST_HEADER_COLUMNS__
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="items.length < 1">
                <td :colspan="dataColumnCount + 1" class="text-center py-6 text-medium-emphasis">No records yet.</td>
              </tr>
              <tr v-for="(record, index) in items" :key="resolveRowKey(record, index)">
__JSKIT_UI_LIST_ROW_COLUMNS__
                <td class="text-right">
                  <v-btn
                    size="small"
                    variant="text"
                    :to="resolveViewLink(record)"
                    :disabled="!resolveViewLink(record)"
                  >
                    Open
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>

          <div v-if="records.hasMore.value" class="d-flex justify-center pt-4">
            <v-btn variant="text" :loading="records.isLoadingMore.value" @click="records.loadMore">Load more</v-btn>
          </div>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useListCore } from "@jskit-ai/users-web/client/composables/useListCore";
import { toRecord, useUiGeneratorListRuntime } from "./uiSupport.js";

const {
  apiPath,
  queryKey,
  resolveViewPath,
  formatFieldValue
} = useUiGeneratorListRuntime();

const records = useListCore({
  queryKey,
  path: apiPath,
  fallbackLoadError: "Unable to load records."
});

const dataColumnCount = __JSKIT_UI_LIST_DATA_COLUMN_COUNT__;
const items = computed(() => (Array.isArray(records.items.value) ? records.items.value : []));
const showListSkeleton = computed(() => Boolean(records.isInitialLoading.value && items.value.length < 1));

function resolveRowKey(record, index) {
  const item = toRecord(record);
  const recordId = __JSKIT_UI_LIST_RECORD_ID_EXPR__;
  if (recordId != null && String(recordId || "").trim()) {
    return String(recordId);
  }
  return `row-${index}`;
}

function resolveViewLink(record) {
  const item = toRecord(record);
  const recordId = __JSKIT_UI_LIST_RECORD_ID_EXPR__;
  const normalizedRecordId = String(recordId || "").trim();
  if (!normalizedRecordId) {
    return "";
  }

  return resolveViewPath(normalizedRecordId);
}
</script>
