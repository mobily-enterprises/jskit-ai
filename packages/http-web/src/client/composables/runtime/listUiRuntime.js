import { computed } from "vue";
import { asPlainObject } from "../support/scopeHelpers.js";
import {
  createRouteTemplateResolver,
  normalizeRouteParamName,
  selectRecordId,
  toRouteParamValue
} from "../support/routeTemplateHelpers.js";

/** @param {import("../../types.js").ListUiRuntimeOptions} options */
function createListUiRuntime({
  items,
  isInitialLoading,
  recordIdParam = "recordId",
  recordIdSelector = selectRecordId,
  routeParams,
  routeParamNames,
  routePath = "",
  viewUrlTemplate = "",
  editUrlTemplate = ""
}) {
  const normalizedRecordIdParam = normalizeRouteParamName(recordIdParam, {
    context: "useList recordIdParam"
  });
  const normalizedViewUrlTemplate = String(viewUrlTemplate || "").trim();
  const normalizedEditUrlTemplate = String(editUrlTemplate || "").trim();
  const hasViewUrl = Boolean(normalizedViewUrlTemplate);
  const hasEditUrl = Boolean(normalizedEditUrlTemplate);
  const normalizedItems = computed(() => (Array.isArray(items.value) ? items.value : []));
  const showListSkeleton = computed(() => Boolean(isInitialLoading.value && normalizedItems.value.length < 1));

  const { resolveTemplatePath } = createRouteTemplateResolver({
    recordIdParam: normalizedRecordIdParam,
    routeParams,
    routeParamNames,
    routePath,
    anchorMode: "before",
    fillRecordId: false
  });

  function resolveRecordId(record) {
    return toRouteParamValue(recordIdSelector(asPlainObject(record)));
  }

  function resolveRowKey(record, index) {
    const recordId = resolveRecordId(record);
    if (recordId) {
      return recordId;
    }

    return `row-${index}`;
  }

  function resolveViewUrl(record) {
    if (!hasViewUrl) {
      return "";
    }

    const recordId = resolveRecordId(record);
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

    const recordId = resolveRecordId(record);
    if (!recordId) {
      return "";
    }

    return resolveTemplatePath(normalizedEditUrlTemplate, {
      [normalizedRecordIdParam]: recordId
    });
  }

  return {
    hasViewUrl,
    hasEditUrl,
    showListSkeleton,
    resolveParams: resolveTemplatePath,
    resolveRowKey,
    resolveViewUrl,
    resolveEditUrl
  };
}

export { createListUiRuntime };
