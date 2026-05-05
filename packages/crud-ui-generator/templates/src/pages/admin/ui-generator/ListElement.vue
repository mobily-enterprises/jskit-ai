<template>
  <section class="ui-generator-list-element d-flex flex-column ga-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <div class="d-flex align-center ga-3 flex-wrap w-100">
          <div>
            <v-card-title class="px-0">{{ listHeadingTitle }}</v-card-title>
            <v-card-subtitle class="px-0">Manage __JSKIT_UI_RESOURCE_PLURAL_TITLE__.</v-card-subtitle>
          </div>
          <v-spacer />
          <v-btn color="primary" variant="tonal" :loading="records.isFetching" @click="records.reload">Refresh</v-btn>
          <v-btn v-if="UI_NEW_URL" color="primary" variant="flat" :to="records.resolveParams(UI_NEW_URL)">
            New __JSKIT_UI_RESOURCE_SINGULAR_TITLE__
          </v-btn>
        </div>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-text-field
          v-if="records.searchEnabled"
          v-model="records.searchQuery"
          :label="records.searchLabel"
          :placeholder="records.searchPlaceholder"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
          clearable
          class="mb-3 ui-generator-list-search"
          :loading="records.isSearchDebouncing"
        />
        <template v-if="records.showListSkeleton">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </template>
        <template v-else>
          <v-progress-linear v-if="records.isRefetching" indeterminate class="mb-3" />

          <div v-if="records.items.length < 1" class="text-center py-6 text-medium-emphasis">
            No records yet.
          </div>
          <v-table v-else density="comfortable">
            <thead>
              <tr>
__JSKIT_UI_LIST_HEADER_COLUMNS__
                <!-- jskit:crud-ui-fields:list-header -->
                <th v-if="UI_VIEW_URL" class="text-right" />
                <th v-if="UI_EDIT_URL" class="text-right" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(record, index) in records.items" :key="records.resolveRowKey(record, index)">
__JSKIT_UI_LIST_ROW_COLUMNS__
                <!-- jskit:crud-ui-fields:list-row -->
                <td v-if="UI_VIEW_URL" class="text-right">
                  <v-btn
                    size="small"
                    color="primary"
                    variant="outlined"
                    :to="{ path: records.resolveViewUrl(record), query: $route.query }"
                    :disabled="!records.resolveViewUrl(record)"
                  >
                    Open
                  </v-btn>
                </td>
                <td v-if="UI_EDIT_URL" class="text-right">
                  <v-btn
                    size="small"
                    color="primary"
                    variant="tonal"
                    :to="{ path: records.resolveEditUrl(record), query: $route.query }"
                    :disabled="!records.resolveEditUrl(record)"
                  >
                    Edit
                  </v-btn>
                </td>
              </tr>
            </tbody>
          </v-table>

          <div v-if="records.hasMore" class="d-flex justify-center pt-4">
            <v-btn color="primary" variant="outlined" :loading="records.isLoadingMore" @click="records.loadMore">
              Load more
            </v-btn>
          </div>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed } from "vue";
__JSKIT_UI_LIST_PARENT_TITLE_IMPORT_LINE__
import { useCrudList } from "@jskit-ai/users-web/client/composables/useCrudList";
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_LIST_API_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_VIEW_URL = __JSKIT_UI_LIST_PAGE_VIEW_URL__;
const UI_EDIT_URL = __JSKIT_UI_LIST_PAGE_EDIT_URL__;
const UI_NEW_URL = __JSKIT_UI_LIST_PAGE_NEW_URL__;
const UI_RECORD_CHANGED_EVENTS = __JSKIT_UI_LIST_REALTIME_EVENTS__;
const UI_ROUTE_QUERY_BLACKLIST = Object.freeze(["include", "cursor", "limit"]);

const records = useCrudList({
  adapter: UI_OPERATION_ADAPTER || undefined,
  resource: uiResource,
  apiSuffix: UI_LIST_API_URL,
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
    "ui-generator",
    "__JSKIT_UI_RESOURCE_NAMESPACE__",
    "list",
    String(surfaceId || ""),
    String(workspaceSlug || "")
  ],
  search: {
    enabled: true,
    mode: "query"
  },
  syncToRoute: {
    enabled: true,
    mode: "replace",
    search: true,
    queryParams: true,
    queryParamBlacklist: UI_ROUTE_QUERY_BLACKLIST
  },
  placementSource: "ui-generator.__JSKIT_UI_RESOURCE_NAMESPACE__.list",
  fallbackLoadError: "Unable to load records.",
  recordIdParam: UI_RECORD_ID_PARAM,
  recordIdSelector: (item = {}) => __JSKIT_UI_LIST_RECORD_ID_EXPR__,
  viewUrlTemplate: UI_VIEW_URL,
  editUrlTemplate: UI_EDIT_URL,
  realtime: UI_RECORD_CHANGED_EVENTS.length > 0
    ? {
        events: UI_RECORD_CHANGED_EVENTS
      }
    : null
});

__JSKIT_UI_LIST_HEADING_TITLE_SETUP__
</script>

<style scoped>
.ui-generator-list-search {
  max-width: 26rem;
}
</style>
