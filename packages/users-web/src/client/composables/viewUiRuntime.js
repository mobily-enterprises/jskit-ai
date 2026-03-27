import { computed, unref } from "vue";
import { asPlainObject } from "./scopeHelpers.js";
import {
  normalizeRouteParamName,
  toRouteParamValue,
  resolveRouteTemplatePath
} from "./routeTemplateHelpers.js";

function resolveRouteParams(source = null) {
  if (typeof source === "function") {
    return asPlainObject(source());
  }

  return asPlainObject(unref(source));
}

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
  routeRecordId = null,
  apiUrlTemplate = ""
} = {}) {
  const normalizedRecordIdParam = normalizeRouteParamName(recordIdParam, {
    context: "useView recordIdParam"
  });
  const normalizedApiUrlTemplate = String(apiUrlTemplate || "").trim();

  function resolveTemplatePath(urlTemplate = "", extraParams = {}) {
    const normalizedTemplate = String(urlTemplate || "").trim();
    if (!normalizedTemplate) {
      return "";
    }

    const currentRouteParams = resolveRouteParams(routeParams);
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

    return resolveRouteTemplatePath(normalizedTemplate, sourceParams);
  }

  const recordId = computed(() =>
    resolveRecordId({
      routeParams: resolveRouteParams(routeParams),
      recordIdParam: normalizedRecordIdParam,
      routeRecordId
    })
  );
  const apiSuffix = computed(() => resolveTemplatePath(normalizedApiUrlTemplate));

  return Object.freeze({
    recordId,
    apiSuffix
  });
}

export { createViewUiRuntime };
