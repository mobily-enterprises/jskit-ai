import { computed, unref } from "vue";
import { asPlainObject } from "./scopeHelpers.js";
import {
  normalizeRouteParamName,
  resolveRouteParamsSource,
  resolveScopedRoutePathname,
  resolveRouteTemplateLocation,
  toRouteParamValue
} from "./routeTemplateHelpers.js";

function toResolvedRecordId({ routeParams, recordIdParam, routeRecordId }) {
  const explicitRecordId = toRouteParamValue(
    typeof routeRecordId === "function" ? routeRecordId() : unref(routeRecordId)
  );
  if (explicitRecordId) {
    return explicitRecordId;
  }

  return toRouteParamValue(routeParams[recordIdParam]);
}

function resolveSavedRecordId(payload, saveRecordIdSelector) {
  const sourcePayload = asPlainObject(payload);
  if (typeof saveRecordIdSelector === "function") {
    return toRouteParamValue(saveRecordIdSelector(sourcePayload));
  }

  return toRouteParamValue(sourcePayload.id);
}

function createAddEditUiRuntime({
  recordIdParam = "recordId",
  routeParams = null,
  routeParamNames = null,
  routePath = "",
  routeRecordId = null,
  apiUrlTemplate = "",
  viewUrlTemplate = "",
  listUrlTemplate = "",
  saveRecordIdSelector = null
} = {}) {
  const normalizedRecordIdParam = normalizeRouteParamName(recordIdParam, {
    context: "useAddEdit recordIdParam"
  });
  const normalizedApiUrlTemplate = String(apiUrlTemplate || "").trim();
  const normalizedViewUrlTemplate = String(viewUrlTemplate || "").trim();
  const normalizedListUrlTemplate = String(listUrlTemplate || "").trim();

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
    const resolvedRecordId = toRouteParamValue(sourceParams[normalizedRecordIdParam]) ||
      toResolvedRecordId({
        routeParams: currentRouteParams,
        recordIdParam: normalizedRecordIdParam,
        routeRecordId
      });
    sourceParams[normalizedRecordIdParam] = resolvedRecordId;
    const currentPathname = resolveScopedRoutePathname({
      currentPathname: routePath,
      params: currentRouteParams,
      orderedParamNames: routeParamNames,
      anchorParamName: normalizedRecordIdParam,
      anchorParamValue: resolvedRecordId,
      anchorMode: "after"
    });

    return resolveRouteTemplateLocation(normalizedTemplate, {
      params: sourceParams,
      currentPathname
    });
  }

  const recordId = computed(() =>
    toResolvedRecordId({
      routeParams: resolveRouteParamsSource(routeParams),
      recordIdParam: normalizedRecordIdParam,
      routeRecordId
    })
  );

  const apiSuffix = computed(() => resolveTemplatePath(normalizedApiUrlTemplate));
  const listUrl = computed(() => resolveTemplatePath(normalizedListUrlTemplate));
  const cancelUrl = computed(() => resolveTemplatePath(normalizedViewUrlTemplate) || listUrl.value);

  function resolveParams(urlTemplate = "", extraParams = {}) {
    return resolveTemplatePath(urlTemplate, extraParams);
  }

  function resolveViewUrl(recordIdLike = "") {
    const targetRecordId = toRouteParamValue(recordIdLike);
    if (!targetRecordId) {
      return "";
    }

    return resolveTemplatePath(normalizedViewUrlTemplate, {
      [normalizedRecordIdParam]: targetRecordId
    });
  }

  function resolveSavedViewUrl(payload = {}) {
    const targetRecordId = resolveSavedRecordId(payload, saveRecordIdSelector);
    if (!targetRecordId) {
      return "";
    }

    return resolveViewUrl(targetRecordId);
  }

  return Object.freeze({
    recordId,
    apiSuffix,
    listUrl,
    cancelUrl,
    resolveParams,
    resolveViewUrl,
    resolveSavedViewUrl
  });
}

export { createAddEditUiRuntime };
