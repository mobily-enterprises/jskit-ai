import { computed } from "vue";
import { asPlainObject } from "../support/scopeHelpers.js";
import {
  normalizeRouteParamName,
  toRouteParamValue,
  resolveRouteParamsSource,
  resolveScopedRoutePathname,
  resolveRouteTemplateLocation
} from "../support/routeTemplateHelpers.js";

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
  routeParamNames = null,
  routePath = "",
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

  function resolveTemplatePath(urlTemplate = "", extraParams = {}) {
    const normalizedTemplate = String(urlTemplate || "").trim();
    if (!normalizedTemplate) {
      return "";
    }

    const currentRouteParams = resolveRouteParamsSource(routeParams);
    const sourceParams = {
      ...currentRouteParams,
      ...asPlainObject(extraParams)
    };
    const currentPathname = resolveScopedRoutePathname({
      currentPathname: routePath,
      params: currentRouteParams,
      orderedParamNames: routeParamNames,
      anchorParamName: normalizedRecordIdParam,
      anchorParamValue: currentRouteParams[normalizedRecordIdParam],
      anchorMode: "before"
    });

    return resolveRouteTemplateLocation(normalizedTemplate, {
      params: sourceParams,
      currentPathname
    });
  }

  function resolveParams(urlTemplate = "", extraParams = {}) {
    return resolveTemplatePath(urlTemplate, extraParams);
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

    return resolveTemplatePath(normalizedViewUrlTemplate, {
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

    return resolveTemplatePath(normalizedEditUrlTemplate, {
      [normalizedRecordIdParam]: recordId
    });
  }

  return Object.freeze({
    hasViewUrl,
    hasEditUrl,
    actionColumnCount,
    showListSkeleton,
    resolveParams,
    resolveRowKey,
    resolveViewUrl,
    resolveEditUrl
  });
}

export { createListUiRuntime };
