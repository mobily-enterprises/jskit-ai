import { computed, unref } from "vue";
import { useRoute } from "vue-router";
import { useCrudView } from "./records/useCrudView.js";

function useCrudViewScreen({
  adapter = null,
  resource = null,
  resourceNamespace = "resource",
  apiUrlTemplate = "",
  recordIdParam = "recordId",
  titleFallbackFieldKey = "",
  listUrlTemplate = "",
  editUrlTemplate = "",
  recordChangedEvent = "",
  requestRecoveryLabel = "Record",
  fallbackLoadError = "Unable to load record.",
  notFoundMessage = "Record not found."
} = {}) {
  const route = useRoute();
  const normalizedResourceNamespace = String(resourceNamespace || "resource").trim() || "resource";
  const view = useCrudView({
    adapter: adapter || undefined,
    resource,
    apiUrlTemplate,
    recordIdParam,
    includeRecordIdInQueryKey: true,
    queryKeyFactory: (surfaceId = "", workspaceSlug = "") => [
      "ui-generator",
      normalizedResourceNamespace,
      "view",
      String(surfaceId || ""),
      String(workspaceSlug || "")
    ],
    placementSource: `ui-generator.${normalizedResourceNamespace}.view`,
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
    view.resolveRecordTitle(view.record, {
      fallbackKey: titleFallbackFieldKey,
      defaultValue: "Record"
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
