import { computed } from "vue";
import { useCrudList } from "./records/useCrudList.js";
import { useCrudListBulkActions } from "./useCrudListBulkActions.js";
import { useCrudListFilters } from "./useCrudListFilters.js";

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
  routeQueryBlacklist = Object.freeze(["include", "cursor", "limit"]),
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
  const bulkActions = useCrudListBulkActions(listBulkActions, {
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
    listPrimaryAction,
    hasViewUrl: Boolean(viewUrlTemplate),
    hasEditUrl: Boolean(editUrlTemplate),
    resolveRecordTitle,
    formatListCardValue: formatCrudListCardValue
  });
}

export { useCrudListScreen };
