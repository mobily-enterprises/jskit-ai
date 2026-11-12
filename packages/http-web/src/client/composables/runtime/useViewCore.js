import { computed } from "vue";
import { watchResourceModelState } from "./modelStateHelpers.js";
import { resolveLoadErrorStatus } from "../support/resourceLoadStateHelpers.js";
import { useJskitText } from "../../i18n.js";

const { t } = useJskitText();

function normalizeStatusList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0);
  }

  return [404];
}

/** @param {import("../../types.js").ViewCoreOptions} options */
function useViewCore({
  resource,
  model,
  canView,
  mapLoadedToModel,
  notFoundStatuses = [404],
  notFoundMessage = ""
}) {
  const statusList = normalizeStatusList(notFoundStatuses);
  watchResourceModelState({
    resource,
    model,
    mapLoadedToModel,
    resolveMapContext() {
      return {
        resource
      };
    }
  });

  const record = computed(() => (model !== undefined ? model : resource.data.value));
  const isLoading = computed(() => Boolean(resource.isInitialLoading.value));
  const isFetching = computed(() => Boolean(resource.isFetching.value));
  const error = computed(() => resource.query.error.value || null);

  // The HTTP status of the failed load, or 0.
  const errorStatus = computed(() => resolveLoadErrorStatus(error.value));
  const isNotFound = computed(() => statusList.includes(errorStatus.value));

  const notFoundError = computed(() => {
    if (!isNotFound.value) {
      return "";
    }

    return String(notFoundMessage || t("jskit.http.crud.recordNotFound"));
  });

  const loadError = computed(() => {
    if (isNotFound.value) {
      return "";
    }

    return String(resource.loadError.value || "").trim();
  });

  const resolvedCanView = computed(() => {
    if (canView === undefined) {
      return true;
    }

    return Boolean(canView?.value);
  });

  async function refresh() {
    return resource.reload();
  }

  return {
    record,
    isLoading,
    isFetching,
    errorStatus,
    isNotFound,
    notFoundError,
    loadError,
    canView: resolvedCanView,
    refresh
  };
}

export { useViewCore };
