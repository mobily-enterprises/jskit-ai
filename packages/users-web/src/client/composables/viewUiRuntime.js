import { computed, unref } from "vue";
import { asPlainObject } from "./scopeHelpers.js";
import {
  normalizeRouteParamName,
  resolveRouteParamsSource,
  resolveScopedRoutePathname,
  resolveRouteTemplateLocation,
  toRouteParamValue
} from "./routeTemplateHelpers.js";

function resolveRecordId({ routeParams, recordIdParam, routeRecordId }) {
  const explicitRecordId = toRouteParamValue(
    typeof routeRecordId === "function" ? routeRecordId() : unref(routeRecordId)
  );
  if (explicitRecordId) {
    return explicitRecordId;
  }

  return toRouteParamValue(routeParams[recordIdParam]);
}

function createViewUiRuntime({
  recordIdParam = "recordId",
  routeParams = null,
  routeParamNames = null,
  routePath = "",
  routeRecordId = null,
  apiUrlTemplate = "",
  listUrlTemplate = "",
  editUrlTemplate = ""
} = {}) {
  const normalizedRecordIdParam = normalizeRouteParamName(recordIdParam, {
    context: "useView recordIdParam"
  });
  const normalizedApiUrlTemplate = String(apiUrlTemplate || "").trim();
  const normalizedListUrlTemplate = String(listUrlTemplate || "").trim();
  const normalizedEditUrlTemplate = String(editUrlTemplate || "").trim();

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
      resolveRecordId({
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
      anchorMode: "at"
    });

    return resolveRouteTemplateLocation(normalizedTemplate, {
      params: sourceParams,
      currentPathname
    });
  }

  const recordId = computed(() =>
    resolveRecordId({
      routeParams: resolveRouteParamsSource(routeParams),
      recordIdParam: normalizedRecordIdParam,
      routeRecordId
    })
  );
  const apiSuffix = computed(() => resolveTemplatePath(normalizedApiUrlTemplate));
  const listUrl = computed(() => resolveTemplatePath(normalizedListUrlTemplate));
  const editUrl = computed(() => resolveTemplatePath(normalizedEditUrlTemplate));

  function resolveParams(urlTemplate = "", extraParams = {}) {
    return resolveTemplatePath(urlTemplate, extraParams);
  }

  return Object.freeze({
    recordId,
    apiSuffix,
    listUrl,
    editUrl,
    resolveParams
  });
}

export { createViewUiRuntime };
