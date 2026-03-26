import { computed, unref } from "vue";
import { asPlainObject } from "./scopeHelpers.js";
import {
  normalizeRouteParamName,
  toRouteParamValue,
  resolveRouteTemplatePath
} from "./routeTemplateHelpers.js";

function resolveRecordId(record, recordIdSelector) {
  const item = asPlainObject(record);
  if (typeof recordIdSelector === "function") {
    return toRouteParamValue(recordIdSelector(item));
  }

  return toRouteParamValue(item.id);
}

function createListUiRuntime({
  items,
  isInitialLoading,
  recordIdParam = "recordId",
  recordIdSelector = null,
  routeParams = null,
  viewUrlTemplate = "",
  editUrlTemplate = ""
} = {}) {
  const normalizedRecordIdParam = normalizeRouteParamName(recordIdParam, {
    context: "useList recordIdParam"
  });
  const normalizedViewUrlTemplate = String(viewUrlTemplate || "").trim();
  const normalizedEditUrlTemplate = String(editUrlTemplate || "").trim();
  const hasViewUrl = Boolean(normalizedViewUrlTemplate);
  const hasEditUrl = Boolean(normalizedEditUrlTemplate);
  const actionColumnCount = (hasViewUrl ? 1 : 0) + (hasEditUrl ? 1 : 0);
  const normalizedItems = computed(() => (Array.isArray(items?.value) ? items.value : []));
  const showListSkeleton = computed(() => Boolean(isInitialLoading?.value && normalizedItems.value.length < 1));

  function resolveRouteParams() {
    if (typeof routeParams === "function") {
      return asPlainObject(routeParams());
    }

    return asPlainObject(unref(routeParams));
  }

  function resolveRowKey(record, index) {
    const recordId = resolveRecordId(record, recordIdSelector);
    if (recordId) {
      return recordId;
    }

    return `row-${index}`;
  }

  function resolveViewUrl(record) {
    if (!hasViewUrl) {
      return "";
    }

    const recordId = resolveRecordId(record, recordIdSelector);
    if (!recordId) {
      return "";
    }

    return resolveRouteTemplatePath(normalizedViewUrlTemplate, {
      ...resolveRouteParams(),
      [normalizedRecordIdParam]: recordId
    });
  }

  function resolveEditUrl(record) {
    if (!hasEditUrl) {
      return "";
    }

    const recordId = resolveRecordId(record, recordIdSelector);
    if (!recordId) {
      return "";
    }

    return resolveRouteTemplatePath(normalizedEditUrlTemplate, {
      ...resolveRouteParams(),
      [normalizedRecordIdParam]: recordId
    });
  }

  return Object.freeze({
    hasViewUrl,
    hasEditUrl,
    actionColumnCount,
    showListSkeleton,
    resolveRowKey,
    resolveViewUrl,
    resolveEditUrl
  });
}

export { createListUiRuntime };
