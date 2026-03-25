<template>
  <section class="ui-generator-view-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">{{ title }}</v-card-title>
            <v-card-subtitle class="px-0">Generated detail view for ${option:namespace|singular|default(record)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn v-if="hasListRoute" variant="text" :to="listPath">Back to ${option:namespace|plural|default(records)}</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <div v-if="isNotFound" class="text-body-2 text-medium-emphasis py-2">Record unavailable.</div>
        <div v-else-if="resource.loadError.value" class="text-body-2 text-error py-2">{{ resource.loadError.value }}</div>

        <template v-else-if="resource.isLoading.value">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </template>

        <template v-else>
          <v-progress-linear v-if="resource.isRefetching.value" indeterminate class="mb-4" />
          <v-row>
__JSKIT_UI_VIEW_COLUMNS__
          </v-row>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { toRecord, useUiGeneratorViewRuntime } from "./uiSupport.js";

const {
  recordId,
  listPath,
  apiPath,
  queryKey,
  formatFieldValue
} = useUiGeneratorViewRuntime();
const hasListRoute = __JSKIT_UI_HAS_LIST_ROUTE__;

const resource = useEndpointResource({
  queryKey,
  path: apiPath,
  fallbackLoadError: "Unable to load record."
});

const record = computed(() => toRecord(resource.data.value));
const isNotFound = computed(() => {
  const error = resource.query.error.value;
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  return status === 404;
});

const title = computed(() => {
  const primaryValue = formatFieldValue(
    __JSKIT_UI_VIEW_PRIMARY_ACCESSOR__,
    __JSKIT_UI_VIEW_PRIMARY_TYPE__,
    __JSKIT_UI_VIEW_PRIMARY_FORMAT__
  );
  if (primaryValue && primaryValue !== "—") {
    return primaryValue;
  }

  const normalizedRecordId = String(recordId.value || "").trim();
  if (!normalizedRecordId) {
    return "${option:namespace|singular|pascal|default(Record)}";
  }

  return `${option:namespace|singular|pascal|default(Record)} #${normalizedRecordId}`;
});
</script>
