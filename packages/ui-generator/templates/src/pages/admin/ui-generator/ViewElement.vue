<template>
  <section class="ui-generator-view-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">${option:namespace|singular|pascal|default(Record)}</v-card-title>
            <v-card-subtitle class="px-0">View and manage this ${option:namespace|singular|default(record)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn v-if="UI_LIST_URL" variant="text" :to="UI_LIST_URL">Back to ${option:namespace|plural|default(records)}</v-btn>
          <v-btn v-if="UI_EDIT_URL" color="primary" variant="outlined" :to="UI_EDIT_URL">Edit</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <div v-if="view.loadError.value || view.isNotFound.value" class="text-body-2 text-medium-emphasis py-2">
          Record unavailable.
        </div>

        <template v-else-if="view.isLoading.value">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </template>

        <template v-else>
          <v-progress-linear v-if="view.isRefetching.value" indeterminate class="mb-4" />
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
import { useRoute } from "vue-router";
import { useView } from "@jskit-ai/users-web/client/composables/useView";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "${option:id-param|trim}";
const UI_API_BASE_URL = "${option:api-path|trim}";
const UI_VIEW_API_URL = `${UI_API_BASE_URL}/:${UI_RECORD_ID_PARAM}`;
const UI_HAS_LIST_ROUTE = __JSKIT_UI_HAS_LIST_ROUTE__;
const UI_HAS_EDIT_ROUTE = __JSKIT_UI_HAS_EDIT_ROUTE__;
const UI_LIST_URL = UI_HAS_LIST_ROUTE ? ".." : "";
const UI_EDIT_URL = UI_HAS_EDIT_ROUTE ? "./edit" : "";
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;

const route = useRoute();

function toRouteRecordId(value) {
  if (Array.isArray(value)) {
    return toRouteRecordId(value[0]);
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function resolveTemplateUrl(urlTemplate = "", params = {}) {
  const normalizedTemplate = String(urlTemplate || "").trim();
  if (!normalizedTemplate) {
    return "";
  }

  const source = params && typeof params === "object" && !Array.isArray(params) ? params : {};
  const missingParams = [];
  const resolvedPath = normalizedTemplate.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, key) => {
    const value = String(source[key] || "").trim();
    if (!value) {
      missingParams.push(key);
      return `:${key}`;
    }

    return encodeURIComponent(value);
  });

  if (missingParams.length > 0) {
    return "";
  }

  return resolvedPath;
}

const recordId = computed(() => toRouteRecordId(route.params?.[UI_RECORD_ID_PARAM]));
const apiSuffix = computed(() =>
  resolveTemplateUrl(UI_VIEW_API_URL, {
    [UI_RECORD_ID_PARAM]: recordId.value
  })
);

const view = useView({
  adapter: UI_OPERATION_ADAPTER || undefined,
  apiSuffix,
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "ui-generator",
    "${option:namespace|kebab}",
    "view",
    String(surfaceId || ""),
    String(workspaceSlug || ""),
    recordId.value
  ],
  placementSource: "ui-generator.${option:namespace|kebab}.view",
  fallbackLoadError: "Unable to load record.",
  notFoundMessage: "Record not found.",
  realtime: UI_RECORD_CHANGED_EVENT
    ? {
        event: UI_RECORD_CHANGED_EVENT
      }
    : null
});

const record = computed(() => {
  const payload = view.record.value;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  return payload;
});
</script>
