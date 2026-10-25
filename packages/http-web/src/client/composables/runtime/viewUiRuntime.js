import { computed } from "vue";
import {
  createRouteTemplateResolver,
  normalizeRouteParamName
} from "../support/routeTemplateHelpers.js";

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

  const { resolveRecordId, resolveTemplatePath } = createRouteTemplateResolver({
    recordIdParam: normalizedRecordIdParam,
    routeParams,
    routeParamNames,
    routePath,
    routeRecordId,
    anchorMode: "at",
    anchorOnTargetRecord: true
  });

  const recordId = computed(() => resolveRecordId());
  const apiSuffix = computed(() => resolveTemplatePath(normalizedApiUrlTemplate));
  const listUrl = computed(() => resolveTemplatePath(normalizedListUrlTemplate));
  const editUrl = computed(() => resolveTemplatePath(normalizedEditUrlTemplate));

  return Object.freeze({
    recordId,
    apiSuffix,
    listUrl,
    editUrl,
    resolveParams: resolveTemplatePath
  });
}

export { createViewUiRuntime };
