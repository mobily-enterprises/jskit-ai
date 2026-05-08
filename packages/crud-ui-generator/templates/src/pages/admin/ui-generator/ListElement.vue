<template>
  <section class="generated-ui-screen generated-ui-screen--operator ui-generator-list-element d-flex flex-column ga-4">
    <header class="ui-generator-list-header">
      <div class="ui-generator-list-header__copy">
        <p class="text-overline text-medium-emphasis mb-1">__JSKIT_UI_RESOURCE_PLURAL_TITLE__</p>
        <h1 class="ui-generator-list-header__title">{{ listHeadingTitle }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Search, review, and update __JSKIT_UI_RESOURCE_PLURAL_TITLE__ from this screen.
        </p>
      </div>
      <div class="ui-generator-list-header__actions">
        <v-btn color="primary" variant="tonal" :loading="records.isFetching" @click="records.reload">Refresh</v-btn>
        <v-btn
          v-if="listPrimaryAction"
          class="ui-generator-list-header__primary-action"
          color="primary"
          variant="flat"
          :to="listPrimaryAction"
        >
          __JSKIT_UI_LIST_CREATE_LABEL__
        </v-btn>
      </div>
    </header>

    <v-sheet rounded="lg" border class="ui-generator-list-panel">
      <div class="ui-generator-list-toolbar">
        <v-text-field
          v-if="records.searchEnabled"
          v-model="records.searchQuery"
          :label="records.searchLabel"
          :placeholder="records.searchPlaceholder"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
          clearable
          class="ui-generator-list-search"
          :loading="records.isSearchDebouncing"
        />
        <CrudListFilterSurface
          :filters="listFilters"
          :runtime="filterRuntime"
        />
      </div>
      <CrudListBulkActionSurface :runtime="bulkActions" />

      <template v-if="records.showListSkeleton">
        <div class="pa-4">
          <v-skeleton-loader type="text@2, list-item-two-line@5" />
        </div>
      </template>
      <template v-else>
        <v-progress-linear v-if="records.isRefetching" indeterminate />

        <div v-if="records.loadError" class="ui-generator-list-state">
          <h2 class="text-h6 mb-2">__JSKIT_UI_LIST_LOAD_ERROR_TITLE__</h2>
          <p class="text-body-2 text-medium-emphasis mb-4">__JSKIT_UI_LIST_LOAD_ERROR_BODY__</p>
          <v-btn color="primary" variant="tonal" :loading="records.isFetching" @click="records.reload">Retry</v-btn>
        </div>

        <div v-else-if="records.items.length < 1" class="ui-generator-list-state">
          <h2 class="text-h6 mb-2">__JSKIT_UI_LIST_EMPTY_TITLE__</h2>
          <p class="text-body-2 text-medium-emphasis mb-4">__JSKIT_UI_LIST_EMPTY_BODY__</p>
          <v-btn v-if="listPrimaryAction" color="primary" variant="flat" :to="listPrimaryAction">
            __JSKIT_UI_LIST_CREATE_LABEL__
          </v-btn>
        </div>

        <template v-else>
          <div class="ui-generator-list-cards d-md-none">
            <v-sheet
              v-for="(record, index) in records.items"
              :key="records.resolveRowKey(record, index)"
              rounded="lg"
              border
              class="ui-generator-list-card"
            >
              <div class="ui-generator-list-card__header">
                <v-checkbox-btn
                  v-if="bulkActions.hasActions.value"
                  :model-value="bulkActions.isRecordSelected(record, index)"
                  :aria-label="`Select ${resolveListRecordTitle(record)}`"
                  class="ui-generator-list-card__select"
                  @update:model-value="bulkActions.setRecordSelected(record, index, $event)"
                />
                <div class="min-w-0">
                  <div class="ui-generator-list-card__title">{{ resolveListRecordTitle(record) }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ records.resolveRowKey(record, index) }}
                  </div>
                </div>
                <v-menu v-if="UI_VIEW_URL || UI_EDIT_URL" location="bottom end">
                  <template #activator="{ props: menuProps }">
                    <v-btn v-bind="menuProps" variant="text" size="small">Actions</v-btn>
                  </template>
                  <v-list density="compact" min-width="140">
                    <v-list-item
                      v-if="UI_VIEW_URL"
                      title="Open"
                      :to="{ path: records.resolveViewUrl(record), query: $route.query }"
                      :disabled="!records.resolveViewUrl(record)"
                    />
                    <v-list-item
                      v-if="UI_EDIT_URL"
                      title="Edit"
                      :to="{ path: records.resolveEditUrl(record), query: $route.query }"
                      :disabled="!records.resolveEditUrl(record)"
                    />
                  </v-list>
                </v-menu>
              </div>
              <div class="ui-generator-list-card__fields">
__JSKIT_UI_LIST_CARD_FIELDS__
                <!-- jskit:crud-ui-fields:list-card -->
              </div>
            </v-sheet>
          </div>

          <div class="ui-generator-list-table d-none d-md-block">
            <v-table density="comfortable">
              <thead>
                <tr>
                  <th v-if="bulkActions.hasActions.value" class="ui-generator-list-table__select">
                    <v-checkbox-btn
                      :model-value="bulkActions.allVisibleSelected(records.items)"
                      :indeterminate="
                        bulkActions.someVisibleSelected(records.items) &&
                        !bulkActions.allVisibleSelected(records.items)
                      "
                      aria-label="Select visible rows"
                      @update:model-value="bulkActions.setVisibleSelected(records.items, $event)"
                    />
                  </th>
__JSKIT_UI_LIST_HEADER_COLUMNS__
                  <!-- jskit:crud-ui-fields:list-header -->
                  <th v-if="UI_VIEW_URL" class="text-right" />
                  <th v-if="UI_EDIT_URL" class="text-right" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="(record, index) in records.items" :key="records.resolveRowKey(record, index)">
                  <td v-if="bulkActions.hasActions.value" class="ui-generator-list-table__select">
                    <v-checkbox-btn
                      :model-value="bulkActions.isRecordSelected(record, index)"
                      :aria-label="`Select ${resolveListRecordTitle(record)}`"
                      @update:model-value="bulkActions.setRecordSelected(record, index, $event)"
                    />
                  </td>
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
          </div>
        </template>

        <div v-if="records.hasMore" class="d-flex justify-center pa-4">
          <v-btn color="primary" variant="outlined" :loading="records.isLoadingMore" @click="records.loadMore">
            Load more
          </v-btn>
        </div>
      </template>
    </v-sheet>

    <v-btn
      v-if="listPrimaryAction"
      class="ui-generator-list-fab d-md-none"
      color="primary"
      variant="flat"
      :to="listPrimaryAction"
    >
      New
    </v-btn>
  </section>
</template>

<script setup>
import { computed } from "vue";
__JSKIT_UI_LIST_PARENT_TITLE_IMPORT_LINE__
import CrudListBulkActionSurface from "@jskit-ai/users-web/client/components/CrudListBulkActionSurface";
import CrudListFilterSurface from "@jskit-ai/users-web/client/components/CrudListFilterSurface";
import { useCrudList } from "@jskit-ai/users-web/client/composables/useCrudList";
import { useCrudListBulkActions } from "@jskit-ai/users-web/client/composables/useCrudListBulkActions";
import { useCrudListFilters } from "@jskit-ai/users-web/client/composables/useCrudListFilters";
import { resource as uiResource } from "__JSKIT_UI_RESOURCE_IMPORT_PATH__";
import { listBulkActions } from "./listBulkActions.js";
import { listFilters } from "./listFilters.js";

const UI_OPERATION_ADAPTER = null;
const UI_RECORD_ID_PARAM = "__JSKIT_UI_RECORD_ID_PARAM__";
const UI_LIST_API_URL = "__JSKIT_UI_API_BASE_URL__";
const UI_VIEW_URL = __JSKIT_UI_LIST_PAGE_VIEW_URL__;
const UI_EDIT_URL = __JSKIT_UI_LIST_PAGE_EDIT_URL__;
const UI_NEW_URL = __JSKIT_UI_LIST_PAGE_NEW_URL__;
const UI_RECORD_CHANGED_EVENTS = __JSKIT_UI_LIST_REALTIME_EVENTS__;
const UI_ROUTE_QUERY_BLACKLIST = Object.freeze(["include", "cursor", "limit"]);
const UI_LIST_TITLE_FALLBACK_FIELD_KEY = __JSKIT_UI_LIST_TITLE_FALLBACK_FIELD_KEY__;
const filterRuntime = useCrudListFilters(listFilters);

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
  queryParams: filterRuntime.queryParams,
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

const bulkActions = useCrudListBulkActions(listBulkActions, {
  resolveRecordId: (record, index) => records.resolveRowKey(record, index),
  resolveContext: () => ({
    records,
    reload: records.reload
  })
});

__JSKIT_UI_LIST_HEADING_TITLE_SETUP__

const listPrimaryAction = computed(() => (UI_NEW_URL ? records.resolveParams(UI_NEW_URL) : ""));

function resolveListRecordTitle(record) {
  return records.resolveRecordTitle(record, {
    fallbackKey: UI_LIST_TITLE_FALLBACK_FIELD_KEY,
    defaultValue: "__JSKIT_UI_RESOURCE_SINGULAR_TITLE__"
  });
}

function formatListCardValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  return value;
}
</script>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.35rem, 2vw, 1.85rem);
  --generated-ui-screen-state-padding: 2.5rem 1.25rem;
}

.generated-ui-screen--operator {
  --generated-ui-screen-state-padding: 2rem 1rem;
}

.ui-generator-list-header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.ui-generator-list-header__copy {
  min-width: 0;
}

.ui-generator-list-header__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 0.35rem;
}

.ui-generator-list-header__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.ui-generator-list-panel {
  overflow: hidden;
}

.ui-generator-list-toolbar {
  padding: 1rem;
}

.ui-generator-list-search {
  max-width: 26rem;
}

.ui-generator-list-state {
  margin-inline: auto;
  max-width: 30rem;
  padding: var(--generated-ui-screen-state-padding);
  text-align: center;
}

.ui-generator-list-cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0 1rem 1rem;
}

.ui-generator-list-card {
  padding: 0.875rem;
}

.ui-generator-list-card__header {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.ui-generator-list-card__select {
  flex: 0 0 auto;
  margin-inline-start: -0.35rem;
  margin-top: -0.35rem;
}

.ui-generator-list-card__title {
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.ui-generator-list-card__fields {
  display: grid;
  gap: 0.65rem;
  margin-top: 0.85rem;
}

.ui-generator-list-card__field {
  display: grid;
  gap: 0.15rem;
}

.ui-generator-list-card__field-label {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  line-height: 1.2;
  text-transform: uppercase;
}

.ui-generator-list-card__field-value {
  font-size: 0.95rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.ui-generator-list-table {
  overflow-x: auto;
}

.ui-generator-list-table__select {
  width: 3rem;
}

.ui-generator-list-fab {
  bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
  position: fixed;
  right: 1rem;
  z-index: 6;
}

@media (max-width: 960px) {
  .ui-generator-list-header {
    flex-direction: column;
  }

  .ui-generator-list-header__actions {
    width: 100%;
  }

  .ui-generator-list-header__actions :deep(.v-btn) {
    min-height: 48px;
  }

  .ui-generator-list-header__primary-action {
    display: none;
  }

  .ui-generator-list-search {
    max-width: none;
  }
}
</style>
