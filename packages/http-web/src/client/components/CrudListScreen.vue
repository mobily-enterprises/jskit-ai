<script setup>
import { computed, unref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ShellPageAction from "@jskit-ai/shell-web/client/components/ShellPageAction";
import ShellPageActions from "@jskit-ai/shell-web/client/components/ShellPageActions";
import ShellPrimaryAction from "@jskit-ai/shell-web/client/components/ShellPrimaryAction";
import CrudListBulkActionSurface from "./CrudListBulkActionSurface.vue";
import CrudListFilterSurface from "./CrudListFilterSurface.vue";
import CrudListRecordActionMenu from "./CrudListRecordActionMenu.vue";
import { isRetryableLoadStatus } from "../composables/support/resourceLoadStateHelpers.js";
import { useJskitText } from "../i18n.js";

// Unset copy comes from the catalog; passed copy may be a message key.
const props = defineProps({
  screen: {
    type: /** @type {import("vue").PropType<import("../types.js").CrudListScreen>} */ (Object),
    required: true
  },
  createLabel: {
    type: String,
    default: undefined
  },
  loadErrorBody: {
    type: String,
    default: undefined
  },
  emptyBody: {
    type: String,
    default: undefined
  }
});

const { t, text } = useJskitText();
const resolvedCreateLabel = computed(() =>
  props.createLabel === undefined ? t("jskit.http.crud.list.newRecord") : text(props.createLabel)
);
const resolvedLoadErrorBody = computed(() =>
  props.loadErrorBody === undefined ? t("jskit.http.crud.list.loadErrorBody") : text(props.loadErrorBody)
);
const resolvedEmptyBody = computed(() =>
  props.emptyBody === undefined ? t("jskit.http.crud.list.emptyBody") : text(props.emptyBody)
);

const route = useRoute();
const router = useRouter();
const records = computed(() => props.screen.records);
// Retry only where trying again can help, as the load notice offers it: a refused load (403, 404, ...) has none.
const canRetryLoad = computed(() => isRetryableLoadStatus(unref(records.value.errorStatus)));
// The connection advice only where trying again can help; a refused load says why instead: the server's message or
// a neutral text for its kind (the runtime's loadRefusalMessage), else the runtime's load error.
const loadErrorText = computed(() =>
  canRetryLoad.value
    ? resolvedLoadErrorBody.value
    : String(unref(records.value.loadRefusalMessage) || unref(records.value.loadError) || "").trim()
);
const bulkActions = computed(() => props.screen.bulkActions);
const rowActions = computed(() => props.screen.rowActions);
const listFilters = computed(() => props.screen.listFilters);
const filterRuntime = computed(() => props.screen.filterRuntime);
const displayRows = computed(() => unref(props.screen.displayRows));
const selectableRows = computed(() => unref(props.screen.selectableRows));
const listPrimaryAction = computed(() => unref(props.screen.listPrimaryAction) || "");
const hasBulkActions = computed(() => Boolean(unref(bulkActions.value.hasActions)));
const hasRowActions = computed(() => Boolean(unref(rowActions.value.hasActions)));
const hasViewUrl = computed(() => Boolean(props.screen.hasViewUrl));
const hasEditUrl = computed(() => Boolean(props.screen.hasEditUrl));
const trailingActionCount = computed(() =>
  Number(hasViewUrl.value) + Number(hasEditUrl.value) + Number(hasRowActions.value)
);
const trailingActionsWidth = computed(() => `${trailingActionCount.value * 48 + 16}px`);

function resolveListRecordTitle(record) {
  return props.screen.resolveRecordTitle(record);
}

function formatListCardValue(value) {
  return props.screen.formatListCardValue(value);
}

function resolveViewLocation(record) {
  const path = records.value.resolveViewUrl(record);
  return path ? { path, query: route.query } : null;
}

function resolveEditLocation(record) {
  const path = records.value.resolveEditUrl(record);
  return path ? { path, query: route.query } : null;
}

// A card or row opens its record: the view page, or the edit page when the list has no view.
function resolveOpenLocation(row) {
  if (row.synthetic) {
    return null;
  }
  return (hasViewUrl.value && resolveViewLocation(row.record)) || (hasEditUrl.value && resolveEditLocation(row.record)) || null;
}

// A click anywhere on a table row opens it, except on the row's own controls.
function openRow(row, event) {
  const location = resolveOpenLocation(row);
  const target = event.target instanceof Element ? event.target : null;
  if (!location || target?.closest("a, button, input, label, select, textarea, [role='button'], [role='checkbox']")) {
    return;
  }
  void router.push(location);
}

function hasRowActionsFor(record, index) {
  return rowActions.value.hasVisibleActionsFor(record, index);
}

function isBulkRowSelected(row) {
  return bulkActions.value.isRecordSelected(row.record, row.index);
}

function setBulkRowSelected(row, selected = true) {
  bulkActions.value.setRecordSelected(row.record, row.index, selected);
}

function allSelectableRowsSelected() {
  return selectableRows.value.length > 0 && selectableRows.value.every((row) => isBulkRowSelected(row));
}

function someSelectableRowsSelected() {
  return selectableRows.value.some((row) => isBulkRowSelected(row));
}

function setSelectableRowsSelected(selected = true) {
  for (const row of selectableRows.value) {
    bulkActions.value.setRecordSelected(row.record, row.index, selected);
  }
}
</script>

<template>
  <section class="crud-screen crud-list">
    <ShellPageActions>
      <ShellPageAction
        icon="$refresh"
        :label="records.isFetching ? t('jskit.http.actions.refreshing') : t('jskit.http.actions.refresh')"
        :disabled="records.isFetching"
        @click="records.reload"
      />
    </ShellPageActions>
    <ShellPrimaryAction v-if="listPrimaryAction" :label="resolvedCreateLabel" :to="listPrimaryAction" />

    <div class="crud-list-toolbar">
      <v-text-field
        v-if="records.searchEnabled"
        v-model="records.searchQuery"
        :placeholder="records.searchPlaceholder || records.searchLabel"
        :aria-label="records.searchLabel"
        variant="solo-filled"
        bg-color="surface-container-high"
        flat
        rounded="pill"
        single-line
        hide-details
        clearable
        prepend-inner-icon="$search"
        class="crud-list-search"
        :aria-busy="records.isSearchDebouncing ? 'true' : undefined"
      />
      <CrudListFilterSurface
        :filters="listFilters"
        :runtime="filterRuntime"
      />
    </div>
    <CrudListBulkActionSurface :runtime="bulkActions" />

    <v-skeleton-loader v-if="records.showListSkeleton" type="list-item-two-line@5" />
    <template v-else>
      <div v-if="records.loadError" class="crud-list-state">
        <v-icon icon="$cloudOff" size="48" class="crud-list-state__icon" />
        <p class="text-body-large">{{ loadErrorText }}</p>
        <v-btn
          v-if="canRetryLoad"
          color="secondary-container"
          prepend-icon="$refresh"
          :disabled="records.isFetching"
          @click="records.reload"
        >
          {{ records.isFetching ? t("jskit.http.actions.retrying") : t("jskit.http.actions.retry") }}
        </v-btn>
      </div>

      <div v-else-if="displayRows.length < 1" class="crud-list-state">
        <v-icon icon="$inbox" size="48" class="crud-list-state__icon" />
        <p class="text-body-large">{{ resolvedEmptyBody }}</p>
        <v-btn v-if="listPrimaryAction" prepend-icon="$add" :to="listPrimaryAction">
          {{ resolvedCreateLabel }}
        </v-btn>
      </div>

      <template v-else>
        <div class="crud-list-cards">
          <v-card
            v-for="row in displayRows"
            :key="row.key"
            class="crud-list-card"
          >
            <div class="crud-list-card__header">
              <v-checkbox-btn
                v-if="hasBulkActions && row.selectable !== false"
                :model-value="isBulkRowSelected(row)"
                :aria-label="t('jskit.http.crud.list.selectRecord', { title: resolveListRecordTitle(row.record) })"
                class="crud-list-card__control"
                @update:model-value="setBulkRowSelected(row, $event)"
              />
              <div class="crud-list-card__heading">
                <RouterLink
                  v-if="resolveOpenLocation(row)"
                  class="crud-list-card__title crud-list-card__link"
                  :to="resolveOpenLocation(row)"
                >
                  {{ resolveListRecordTitle(row.record) }}
                </RouterLink>
                <div v-else class="crud-list-card__title">{{ resolveListRecordTitle(row.record) }}</div>
              </div>
              <CrudListRecordActionMenu
                v-if="(hasViewUrl && hasEditUrl) || hasRowActionsFor(row.record, row.index)"
                class="crud-list-card__control"
                :record="row.record"
                :index="row.index"
                :title="resolveListRecordTitle(row.record)"
                :row-actions="rowActions"
                :show-edit="hasViewUrl && hasEditUrl && !row.synthetic"
                :edit-location="resolveEditLocation(row.record)"
              />
            </div>
            <div class="crud-list-card__fields">
              <slot
                name="card-fields"
                :record="row.record"
                :records="records"
                :index="row.index"
                :row="row"
                :format-list-card-value="formatListCardValue"
              />
            </div>
          </v-card>
        </div>

        <div class="crud-list-table">
          <v-table>
            <thead>
              <tr>
                <th v-if="hasBulkActions" class="crud-list-table__select">
                  <v-checkbox-btn
                    :model-value="allSelectableRowsSelected()"
                    :indeterminate="
                      someSelectableRowsSelected() &&
                        !allSelectableRowsSelected()
                    "
                    :aria-label="t('jskit.http.crud.list.selectVisibleRows')"
                    @update:model-value="setSelectableRowsSelected($event)"
                  />
                </th>
                <slot name="table-header" />
                <th
                  v-if="trailingActionCount > 0"
                  class="crud-list-table__actions"
                  :style="{ width: trailingActionsWidth }"
                />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in displayRows"
                :key="row.key"
                :class="{ 'crud-list-table__row--link': resolveOpenLocation(row) }"
                @click="openRow(row, $event)"
              >
                <td v-if="hasBulkActions" class="crud-list-table__select">
                  <v-checkbox-btn
                    v-if="row.selectable !== false"
                    :model-value="isBulkRowSelected(row)"
                    :aria-label="t('jskit.http.crud.list.selectRecord', { title: resolveListRecordTitle(row.record) })"
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
                <td v-if="trailingActionCount > 0" class="crud-list-table__actions">
                  <v-btn
                    v-if="hasViewUrl && !row.synthetic"
                    icon
                    variant="text"
                    color="on-surface-variant"
                    :to="resolveViewLocation(row.record)"
                    :disabled="!resolveViewLocation(row.record)"
                    :aria-label="t('jskit.http.actions.open')"
                  >
                    <v-icon icon="$chevronRight" />
                    <v-tooltip activator="parent" location="top" :text="t('jskit.http.actions.open')" />
                  </v-btn>
                  <v-btn
                    v-if="hasEditUrl && !row.synthetic"
                    icon
                    variant="text"
                    color="on-surface-variant"
                    :to="resolveEditLocation(row.record)"
                    :disabled="!resolveEditLocation(row.record)"
                    :aria-label="t('jskit.http.actions.edit')"
                  >
                    <v-icon icon="$edit" />
                    <v-tooltip activator="parent" location="top" :text="t('jskit.http.actions.edit')" />
                  </v-btn>
                  <CrudListRecordActionMenu
                    v-if="hasRowActions && hasRowActionsFor(row.record, row.index)"
                    :record="row.record"
                    :index="row.index"
                    :title="resolveListRecordTitle(row.record)"
                    :row-actions="rowActions"
                  />
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </template>

      <div v-if="records.hasMore" class="crud-list-more">
        <v-btn
          variant="outlined"
          color="primary"
          :disabled="records.isLoadingMore"
          @click="records.loadMore"
        >
          {{ records.isLoadingMore ? t("jskit.http.actions.loadingMore") : t("jskit.http.actions.loadMore") }}
        </v-btn>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* The list picks cards or a table from its own width, so it never scrolls sideways beside a drawer or a detail pane. */
.crud-list {
  container: crud-list / inline-size;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.crud-list-toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.crud-list-toolbar:empty {
  display: none;
}

.crud-list-search {
  max-width: 720px;
  width: 100%;
}

.crud-list-state {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-inline: auto;
  max-width: 480px;
  padding: 48px 16px;
  text-align: center;
}

.crud-list-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.crud-list-card {
  padding: 16px;
  position: relative;
}

.crud-list-card__header {
  align-items: flex-start;
  display: flex;
  gap: 12px;
}

.crud-list-card__heading {
  flex: 1 1 auto;
  min-width: 0;
}

.crud-list-card__control {
  flex: 0 0 auto;
  margin-block: -8px;
  position: relative;
  z-index: 1;
}

.crud-list-card__title {
  color: rgb(var(--v-theme-on-surface));
  display: block;
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: 0.009375rem;
  line-height: 1.5rem;
  overflow-wrap: anywhere;
  text-decoration: none;
}

/* The title link covers the whole card, so a tap anywhere opens the record; the card's controls sit above it. */
.crud-list-card__link::after {
  border-radius: inherit;
  content: "";
  inset: 0;
  position: absolute;
  transition: background-color 200ms cubic-bezier(0.2, 0, 0, 1);
}

.crud-list-card__link:hover::after {
  background: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}

.crud-list-card__link:focus-visible {
  outline: none;
}

.crud-list-card__link:focus-visible::after {
  outline: 3px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}

.crud-list-card__fields {
  color: rgb(var(--v-theme-on-surface-variant));
  display: grid;
  gap: 8px;
}

.crud-list-card__fields:not(:empty) {
  margin-top: 12px;
}

.crud-list-table {
  display: none;
}

.crud-list-table :deep(table) {
  table-layout: fixed;
}

.crud-list-table :deep(th),
.crud-list-table :deep(td) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crud-list-table__select {
  width: 56px;
}

.crud-list-table .crud-list-table__actions {
  overflow: visible;
  padding-inline: 8px;
  text-align: end;
}

.crud-list-table__row--link {
  cursor: pointer;
}

.crud-list-table__row--link:hover > td {
  background: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
}

.crud-list-more {
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
}

@container crud-list (min-width: 720px) {
  .crud-list-cards {
    display: none;
  }

  .crud-list-table {
    display: block;
  }
}
</style>
