import { computed } from "vue";
import { asPlainObject } from "../support/scopeHelpers.js";
import {
  createRouteTemplateResolver,
  normalizeRouteParamName,
  toRouteParamValue
} from "../support/routeTemplateHelpers.js";

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

  const { resolveRecordId, resolveTemplatePath } = createRouteTemplateResolver({
    recordIdParam: normalizedRecordIdParam,
    routeParams,
    routeParamNames,
    routePath,
    routeRecordId,
    anchorMode: "after"
  });

  const recordId = computed(() => resolveRecordId());

  const apiSuffix = computed(() => resolveTemplatePath(normalizedApiUrlTemplate));
  const listUrl = computed(() => resolveTemplatePath(normalizedListUrlTemplate));
  const cancelUrl = computed(() => resolveTemplatePath(normalizedViewUrlTemplate) || listUrl.value);

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
    resolveParams: resolveTemplatePath,
    resolveViewUrl,
    resolveSavedViewUrl
  });
}

export { createAddEditUiRuntime };
