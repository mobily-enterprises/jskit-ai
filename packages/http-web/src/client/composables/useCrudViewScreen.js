import { computed, unref } from "vue";
import { useRoute } from "vue-router";
import { useCrudView } from "./records/useCrudView.js";
import { resolveRecordTitle } from "./crud/crudLookupFieldLabelSupport.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

function useCrudViewScreen({
  resource = null,
  resourceNamespace = "resource",
  apiUrlTemplate = "",
  recordIdParam = "recordId",
  titleFallbackFieldKey = "",
  listUrlTemplate = "",
  editUrlTemplate = "",
  recordChangedEvent = "",
  requestQueryParams = null,
  requestFieldsets = null,
  readEnabled = true,
  queryKeyFactory = null,
  requestRecoveryLabel = t("jskit.http.crud.record"),
  fallbackLoadError = t("jskit.http.crud.view.loadFailed"),
  notFoundMessage = t("jskit.http.crud.recordNotFound")
} = {}) {
  const route = useRoute();
  const normalizedResourceNamespace = String(resourceNamespace || "resource").trim() || "resource";
  const defaultQueryKeyFactory = (surfaceId = "", workspaceSlug = "") => [
    "crud",
    normalizedResourceNamespace,
    "view",
    String(surfaceId || ""),
    String(workspaceSlug || "")
  ];
  const view = useCrudView({
    resource,
    apiUrlTemplate,
    recordIdParam,
    includeRecordIdInQueryKey: true,
    queryKeyFactory: typeof queryKeyFactory === "function" ? queryKeyFactory : defaultQueryKeyFactory,
    requestQueryParams,
    requestFieldsets,
    readEnabled,
    placementSource: `crud.${normalizedResourceNamespace}.view`,
    requestRecoveryLabel,
    fallbackLoadError,
    notFoundMessage,
    listUrlTemplate,
    editUrlTemplate,
    realtime: recordChangedEvent
      ? {
          event: recordChangedEvent
        }
      : null
  });
  const recordTitle = computed(() =>
    resolveRecordTitle(view.record, {
      fallbackKey: titleFallbackFieldKey,
      defaultValue: t("jskit.http.crud.record")
    })
  );

  function resolveRouteLocation(urlTemplate = "") {
    const path = view.resolveParams(unref(urlTemplate));
    return path ? { path, query: route.query } : null;
  }

  const listLocation = computed(() => resolveRouteLocation(listUrlTemplate));
  const editLocation = computed(() => resolveRouteLocation(editUrlTemplate));

  return Object.freeze({
    view,
    recordTitle,
    listLocation,
    editLocation
  });
}

export { useCrudViewScreen };
