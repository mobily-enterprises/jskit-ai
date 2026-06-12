import { computed, unref } from "vue";
import { useCrudList } from "./records/useCrudList.js";
import { useCrudListBulkActions } from "./useCrudListBulkActions.js";
import { useCrudListFilters } from "./useCrudListFilters.js";
import { useCrudListRowActions } from "./useCrudListRowActions.js";

function formatCrudListCardValue(value) {
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

function asList(value = []) {
  const resolved = unref(value);
  if (resolved == null) {
    return [];
  }
  return Array.isArray(resolved) ? resolved : [resolved];
}

function hasSyntheticRowGroups(value = null) {
  const source = unref(value);
  return Boolean(
    source &&
      typeof source === "object" &&
      !Array.isArray(source) &&
      (Object.hasOwn(source, "prepend") || Object.hasOwn(source, "append"))
  );
}

function normalizeSyntheticDisplayRow(source = null, index = 0, placement = "prepend") {
  const rawRow = unref(source);
  if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
    return null;
  }

  const hasWrappedRecord = Object.hasOwn(rawRow, "record");
  const record = hasWrappedRecord ? unref(rawRow.record) : rawRow;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const keySource = hasWrappedRecord
    ? rawRow.key
    : record.id ?? record.attributes?.id;
  const recordKey = String(keySource || `synthetic-${placement}-${index + 1}`).trim();

  return Object.freeze({
    key: `synthetic:${placement}:${recordKey}`,
    recordKey,
    record,
    index: hasWrappedRecord && Number.isInteger(rawRow.index) ? rawRow.index : -1,
    synthetic: true,
    selectable: rawRow.selectable === true,
    placement
  });
}

function normalizeSyntheticDisplayRows(value = [], placement = "prepend") {
  return asList(value)
    .map((row, index) => normalizeSyntheticDisplayRow(row, index, placement))
    .filter(Boolean);
}

function normalizeSyntheticDisplayRowGroups(syntheticRows = null) {
  const source = unref(syntheticRows);
  if (hasSyntheticRowGroups(source)) {
    return Object.freeze({
      prepend: normalizeSyntheticDisplayRows(source.prepend, "prepend"),
      append: normalizeSyntheticDisplayRows(source.append, "append")
    });
  }

  return Object.freeze({
    prepend: normalizeSyntheticDisplayRows(source, "prepend"),
    append: []
  });
}

function createCrudListDisplayRow(record = {}, index = 0, records = {}) {
  const resolveRowKey = typeof records.resolveRowKey === "function"
    ? records.resolveRowKey
    : (_record, fallbackIndex) => fallbackIndex;
  const recordKey = String(resolveRowKey(record, index) || index);
  return Object.freeze({
    key: `record:${recordKey}`,
    recordKey,
    record,
    index,
    synthetic: false,
    selectable: true,
    placement: "records"
  });
}

function useCrudListScreen({
  adapter = null,
  resource = null,
  resourceNamespace = "resource",
  apiSuffix = "",
  recordIdParam = "recordId",
  recordIdSelector = null,
  titleFallbackFieldKey = "",
  viewUrlTemplate = "",
  editUrlTemplate = "",
  newUrlTemplate = "",
  recordChangedEvents = [],
  listFilters = {},
  listBulkActions = [],
  listRowActions = [],
  syntheticRows = null,
  routeQueryBlacklist = Object.freeze(["include", "cursor", "limit"]),
  requestQueryParams = null,
  requestRecoveryLabel = "Records",
  fallbackLoadError = "Unable to load records."
} = {}) {
  const filterRuntime = useCrudListFilters(listFilters);
  const normalizedRecordChangedEvents = Array.isArray(recordChangedEvents)
    ? recordChangedEvents
    : [];
  const normalizedResourceNamespace = String(resourceNamespace || "resource").trim() || "resource";
  const records = useCrudList({
    adapter: adapter || undefined,
    resource,
    apiSuffix,
    queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
      "ui-generator",
      normalizedResourceNamespace,
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
      queryParamBlacklist: routeQueryBlacklist
    },
    placementSource: `ui-generator.${normalizedResourceNamespace}.list`,
    requestQueryParams,
    requestRecoveryLabel,
    fallbackLoadError,
    recordIdParam,
    recordIdSelector,
    viewUrlTemplate,
    editUrlTemplate,
    realtime: normalizedRecordChangedEvents.length > 0
      ? {
          events: normalizedRecordChangedEvents
        }
      : null
  });
  const displayRows = computed(() => {
    const syntheticRowGroups = normalizeSyntheticDisplayRowGroups(syntheticRows);
    const recordRows = (Array.isArray(records.items) ? records.items : [])
      .map((record, index) => createCrudListDisplayRow(record, index, records));

    return [
      ...syntheticRowGroups.prepend,
      ...recordRows,
      ...syntheticRowGroups.append
    ];
  });
  const selectableRows = computed(() =>
    displayRows.value.filter((row) => row.selectable !== false)
  );
  const bulkActions = useCrudListBulkActions(listBulkActions, {
    resolveRecordId: (record, index) => records.resolveRowKey(record, index),
    resolveContext: () => ({
      records,
      reload: records.reload
    })
  });
  const rowActions = useCrudListRowActions(listRowActions, {
    resolveRecordId: (record, index) => records.resolveRowKey(record, index),
    resolveContext: () => ({
      records,
      reload: records.reload
    })
  });
  const listPrimaryAction = computed(() =>
    newUrlTemplate ? records.resolveParams(newUrlTemplate) : ""
  );

  function resolveRecordTitle(record) {
    return records.resolveRecordTitle(record, {
      fallbackKey: titleFallbackFieldKey,
      defaultValue: "Record"
    });
  }

  return Object.freeze({
    records,
    listFilters,
    filterRuntime,
    bulkActions,
    listRowActions,
    rowActions,
    displayRows,
    selectableRows,
    listPrimaryAction,
    hasViewUrl: Boolean(viewUrlTemplate),
    hasEditUrl: Boolean(editUrlTemplate),
    resolveRecordTitle,
    formatListCardValue: formatCrudListCardValue
  });
}

export { useCrudListScreen };
