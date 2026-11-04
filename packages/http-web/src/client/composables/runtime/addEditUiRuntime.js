import { computed } from "vue";
import { asPlainObject } from "../support/scopeHelpers.js";
import {
  createRouteTemplateResolver,
  normalizeRouteParamName,
  selectRecordId,
  toRouteParamValue
} from "../support/routeTemplateHelpers.js";

/** @param {import("../../types.js").AddEditUiRuntimeOptions} options */
function createAddEditUiRuntime({
  recordIdParam = "recordId",
  routeParams,
  routeParamNames,
  routePath = "",
  routeRecordId,
  apiUrlTemplate = "",
  viewUrlTemplate = "",
  listUrlTemplate = "",
  saveRecordIdSelector = selectRecordId
}) {
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
    const targetRecordId = toRouteParamValue(saveRecordIdSelector(asPlainObject(payload)));
    if (!targetRecordId) {
      return "";
    }

    return resolveViewUrl(targetRecordId);
  }

  return {
    recordId,
    apiSuffix,
    listUrl,
    cancelUrl,
    resolveParams: resolveTemplatePath,
    resolveViewUrl,
    resolveSavedViewUrl
  };
}

export { createAddEditUiRuntime };
