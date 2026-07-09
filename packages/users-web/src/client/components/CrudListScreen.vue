<script setup>
import { computed, unref } from "vue";
import { useRoute } from "vue-router";
import CrudListBulkActionSurface from "./CrudListBulkActionSurface.vue";
import CrudListFilterSurface from "./CrudListFilterSurface.vue";
import CrudListRecordActionMenu from "./CrudListRecordActionMenu.vue";

const props = defineProps({
  screen: {
    type: Object,
    required: true
  },
  titleLabel: {
    type: String,
    default: "Records"
  },
  headingTitle: {
    type: String,
    default: ""
  },
  subtitle: {
    type: String,
    default: ""
  },
  createLabel: {
    type: String,
    default: "New record"
  },
  loadErrorTitle: {
    type: String,
    default: "Unable to load records"
  },
  loadErrorBody: {
    type: String,
    default: "Check the connection and try again."
  },
  emptyTitle: {
    type: String,
    default: "No records yet"
  },
  emptyBody: {
    type: String,
    default: "Create the first record to start using this workflow."
  }
});

const route = useRoute();
const records = computed(() => props.screen?.records || {});
const bulkActions = computed(() => props.screen?.bulkActions || {});
const rowActions = computed(() => props.screen?.rowActions || {});
const listFilters = computed(() => props.screen?.listFilters || {});
const filterRuntime = computed(() => props.screen?.filterRuntime || null);
const displayRows = computed(() => unref(props.screen?.displayRows) || []);
const selectableRows = computed(() => unref(props.screen?.selectableRows) || []);
const listPrimaryAction = computed(() => unref(props.screen?.listPrimaryAction) || "");
const hasBulkActions = computed(() => Boolean(unref(bulkActions.value?.hasActions)));
const hasRowActions = computed(() => Boolean(unref(rowActions.value?.hasActions)));
const hasViewUrl = computed(() => Boolean(props.screen?.hasViewUrl));
const hasEditUrl = computed(() => Boolean(props.screen?.hasEditUrl));
const resolvedHeadingTitle = computed(() => String(props.headingTitle || props.titleLabel || "").trim());
const resolvedSubtitle = computed(() =>
  String(props.subtitle || `Search, review, and update ${props.titleLabel} from this screen.`).trim()
);

function resolveListRecordTitle(record) {
  if (typeof props.screen?.resolveRecordTitle === "function") {
    return props.screen.resolveRecordTitle(record);
  }
  return "Record";
}

function formatListCardValue(value) {
  if (typeof props.screen?.formatListCardValue === "function") {
    return props.screen.formatListCardValue(value);
  }
  return value;
}

function resolveViewLocation(record) {
  const path = typeof records.value?.resolveViewUrl === "function"
    ? records.value.resolveViewUrl(record)
    : "";
  return path ? { path, query: route.query } : null;
}

function resolveEditLocation(record) {
  const path = typeof records.value?.resolveEditUrl === "function"
    ? records.value.resolveEditUrl(record)
    : "";
  return path ? { path, query: route.query } : null;
}

function hasRowActionsFor(record, index) {
  return typeof rowActions.value?.hasVisibleActionsFor === "function" &&
    rowActions.value.hasVisibleActionsFor(record, index);
}

function isBulkRowSelected(row = {}) {
  return typeof bulkActions.value?.isRecordSelected === "function" &&
    bulkActions.value.isRecordSelected(row.record, row.index);
}

function setBulkRowSelected(row = {}, selected = true) {
  if (typeof bulkActions.value?.setRecordSelected !== "function") {
    return;
  }
  bulkActions.value.setRecordSelected(row.record, row.index, selected);
}

function allSelectableRowsSelected() {
  return selectableRows.value.length > 0 && selectableRows.value.every((row) => isBulkRowSelected(row));
}

function someSelectableRowsSelected() {
  return selectableRows.value.some((row) => isBulkRowSelected(row));
}

function setSelectableRowsSelected(selected = true) {
  if (typeof bulkActions.value?.setRecordSelected !== "function") {
    return;
  }
  for (const row of selectableRows.value) {
    bulkActions.value.setRecordSelected(row.record, row.index, selected);
  }
}
</script>

<template>
  <section class="generated-ui-screen generated-ui-screen--operator ui-generator-list-element d-flex flex-column ga-4">
    <header class="ui-generator-list-header">
      <div class="ui-generator-list-header__copy">
        <p class="text-overline text-medium-emphasis mb-1">{{ titleLabel }}</p>
        <h1 class="ui-generator-list-header__title">{{ resolvedHeadingTitle }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">{{ resolvedSubtitle }}</p>
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
          {{ createLabel }}
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
          <h2 class="text-h6 mb-2">{{ loadErrorTitle }}</h2>
          <p class="text-body-2 text-medium-emphasis mb-4">{{ loadErrorBody }}</p>
          <v-btn color="primary" variant="tonal" :loading="records.isFetching" @click="records.reload">Retry</v-btn>
        </div>

        <div v-else-if="displayRows.length < 1" class="ui-generator-list-state">
          <h2 class="text-h6 mb-2">{{ emptyTitle }}</h2>
          <p class="text-body-2 text-medium-emphasis mb-4">{{ emptyBody }}</p>
          <v-btn v-if="listPrimaryAction" color="primary" variant="flat" :to="listPrimaryAction">
            {{ createLabel }}
          </v-btn>
        </div>

        <template v-else>
          <div class="ui-generator-list-cards">
            <v-sheet
              v-for="row in displayRows"
              :key="row.key"
              rounded="lg"
              border
              class="ui-generator-list-card"
            >
              <div class="ui-generator-list-card__header">
                <v-checkbox-btn
                  v-if="hasBulkActions && row.selectable !== false"
                  :model-value="isBulkRowSelected(row)"
                  :aria-label="`Select ${resolveListRecordTitle(row.record)}`"
                  class="ui-generator-list-card__select"
                  @update:model-value="setBulkRowSelected(row, $event)"
                />
                <div class="min-w-0">
                  <div class="ui-generator-list-card__title">{{ resolveListRecordTitle(row.record) }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ row.recordKey }}
                  </div>
                </div>
                <CrudListRecordActionMenu
                  v-if="hasViewUrl || hasEditUrl || hasRowActionsFor(row.record, row.index)"
                  :record="row.record"
                  :index="row.index"
                  :row-actions="rowActions"
                  :show-view="hasViewUrl && !row.synthetic"
                  :show-edit="hasEditUrl && !row.synthetic"
                  :view-location="resolveViewLocation(row.record)"
                  :edit-location="resolveEditLocation(row.record)"
                />
              </div>
              <div class="ui-generator-list-card__fields">
                <slot
                  name="card-fields"
                  :record="row.record"
                  :records="records"
                  :index="row.index"
                  :row="row"
                  :format-list-card-value="formatListCardValue"
                />
              </div>
            </v-sheet>
          </div>

          <div class="ui-generator-list-table">
            <v-table density="comfortable">
              <thead>
                <tr>
                  <th v-if="hasBulkActions" class="ui-generator-list-table__select">
                    <v-checkbox-btn
                      :model-value="allSelectableRowsSelected()"
                      :indeterminate="
                        someSelectableRowsSelected() &&
                          !allSelectableRowsSelected()
                      "
                      aria-label="Select visible rows"
                      @update:model-value="setSelectableRowsSelected($event)"
                    />
                  </th>
                  <slot name="table-header" />
                  <th v-if="hasViewUrl" class="text-right" />
                  <th v-if="hasEditUrl" class="text-right" />
                  <th v-if="hasRowActions" class="text-right" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in displayRows" :key="row.key">
                  <td v-if="hasBulkActions" class="ui-generator-list-table__select">
                    <v-checkbox-btn
                      v-if="row.selectable !== false"
                      :model-value="isBulkRowSelected(row)"
                      :aria-label="`Select ${resolveListRecordTitle(row.record)}`"
                      @update:model-value="setBulkRowSelected(row, $event)"
                    />
                  </td>
                  <slot
                    name="table-row"
                    :record="row.record"
                    :records="records"
                    :index="row.index"
                    :row="row"
                  />
                  <td v-if="hasViewUrl" class="text-right">
                    <v-btn
                      v-if="!row.synthetic"
                      size="small"
                      color="primary"
                      variant="outlined"
                      :to="resolveViewLocation(row.record)"
                      :disabled="!resolveViewLocation(row.record)"
                    >
                      Open
                    </v-btn>
                  </td>
                  <td v-if="hasEditUrl" class="text-right">
                    <v-btn
                      v-if="!row.synthetic"
                      size="small"
                      color="primary"
                      variant="tonal"
                      :to="resolveEditLocation(row.record)"
                      :disabled="!resolveEditLocation(row.record)"
                    >
                      Edit
                    </v-btn>
                  </td>
                  <td v-if="hasRowActions" class="text-right">
                    <CrudListRecordActionMenu
                      v-if="hasRowActionsFor(row.record, row.index)"
                      :record="row.record"
                      :index="row.index"
                      :row-actions="rowActions"
                      button-label="More"
                      button-variant="outlined"
                    />
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
      class="ui-generator-list-fab"
      color="primary"
      variant="flat"
      :to="listPrimaryAction"
    >
      New
    </v-btn>
  </section>
</template>

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
  display: none;
  overflow-x: auto;
}

.ui-generator-list-table__select {
  width: 3rem;
}

.ui-generator-list-fab {
  bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
  display: flex;
  position: fixed;
  right: 1rem;
  z-index: 6;
}

@media (min-width: 960px) {
  .ui-generator-list-cards {
    display: none;
  }

  .ui-generator-list-table {
    display: block;
  }

  .ui-generator-list-fab {
    display: none;
  }
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
