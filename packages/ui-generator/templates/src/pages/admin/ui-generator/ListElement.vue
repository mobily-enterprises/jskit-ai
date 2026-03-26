<template>
  <section class="ui-generator-list-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">${option:namespace|plural|pascal}</v-card-title>
            <v-card-subtitle class="px-0">Manage ${option:namespace|plural|default(records)}.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn variant="outlined" :loading="records.isFetching.value" @click="records.reload">Refresh</v-btn>
          <v-btn v-if="UI_NEW_URL" color="primary" :to="UI_NEW_URL">New ${option:namespace|singular|default(record)}</v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <template v-if="records.showListSkeleton.value">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </template>
        <template v-else>
          <v-progress-linear v-if="records.isRefetching.value" indeterminate class="mb-3" />

          <div v-if="records.items.value.length < 1" class="text-center py-6 text-medium-emphasis">
            No records yet.
          </div>
          <v-table v-else density="comfortable">
            <thead>
              <tr>
__JSKIT_UI_LIST_HEADER_COLUMNS__
                <th v-if="UI_VIEW_URL" class="text-right">Open</th>
                <th v-if="UI_EDIT_URL" class="text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(record, index) in records.items.value" :key="records.resolveRowKey(record, index)">
__JSKIT_UI_LIST_ROW_COLUMNS__
                <td v-if="UI_VIEW_URL" class="text-right">
                  <v-btn
                    size="small"
                    variant="text"
                    :to="records.resolveViewUrl(record)"
                    :disabled="!records.resolveViewUrl(record)"
                  >
                    Open
                  </v-btn>
                </td>
                <td v-if="UI_EDIT_URL" class="text-right">
                  <v-btn
                    size="small"
                    variant="text"
                    :to="records.resolveEditUrl(record)"
                    :disabled="!records.resolveEditUrl(record)"
                  >
                    Edit
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
import { useList } from "@jskit-ai/users-web/client/composables/useList";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "${option:id-param|trim}";
const UI_LIST_API_URL = "${option:api-path|trim}";
const UI_HAS_VIEW_ROUTE = __JSKIT_UI_HAS_VIEW_ROUTE__;
const UI_HAS_EDIT_ROUTE = __JSKIT_UI_HAS_EDIT_ROUTE__;
const UI_HAS_NEW_ROUTE = __JSKIT_UI_HAS_NEW_ROUTE__;
const UI_VIEW_URL = UI_HAS_VIEW_ROUTE ? `./:${UI_RECORD_ID_PARAM}` : "";
const UI_EDIT_URL = UI_HAS_EDIT_ROUTE ? `./:${UI_RECORD_ID_PARAM}/edit` : "";
const UI_NEW_URL = UI_HAS_NEW_ROUTE ? "./new" : "";
const UI_RECORD_CHANGED_EVENT = __JSKIT_UI_RECORD_CHANGED_EVENT__;

const records = useList({
  adapter: UI_OPERATION_ADAPTER || undefined,
  apiSuffix: UI_LIST_API_URL,
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "ui-generator",
    "${option:namespace|kebab}",
    "list",
    String(surfaceId || ""),
    String(workspaceSlug || "")
  ],
  placementSource: "ui-generator.${option:namespace|kebab}.list",
  fallbackLoadError: "Unable to load records.",
  recordIdParam: UI_RECORD_ID_PARAM,
  recordIdSelector: (item = {}) => __JSKIT_UI_LIST_RECORD_ID_EXPR__,
  viewUrlTemplate: UI_VIEW_URL,
  editUrlTemplate: UI_EDIT_URL,
  realtime: UI_RECORD_CHANGED_EVENT
    ? {
        event: UI_RECORD_CHANGED_EVENT
      }
    : null
});
</script>
