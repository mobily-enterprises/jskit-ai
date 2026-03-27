import { computed } from "vue";
import { watchResourceModelState } from "./modelStateHelpers.js";

function normalizeStatusList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0);
  }

  return [404];
}

function useViewCore({
  resource,
  model,
  canView,
  mapLoadedToModel,
  notFoundStatuses = [404],
  notFoundMessage = "Record not found."
} = {}) {
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

  const data = resource?.data;
  const record = computed(() => (model !== undefined ? model : data?.value));
  const isLoading = computed(() => {
    if (resource?.isInitialLoading?.value !== undefined) {
      return Boolean(resource.isInitialLoading.value);
    }
    return Boolean(resource?.query?.isPending?.value);
  });
  const isFetching = computed(() => {
    if (resource?.isFetching?.value !== undefined) {
      return Boolean(resource.isFetching.value);
    }
    return Boolean(resource?.query?.isFetching?.value);
  });
  const error = computed(() => resource?.query?.error?.value || null);

  const isNotFound = computed(() => {
    const status = Number(error.value?.status || 0);
    return statusList.includes(status);
  });

  const notFoundError = computed(() => {
    if (!isNotFound.value) {
      return "";
    }

    return String(notFoundMessage || "Record not found.");
  });

  const loadError = computed(() => {
    if (isNotFound.value) {
      return "";
    }

    return String(resource?.loadError?.value || "").trim();
  });

  const resolvedCanView = computed(() => {
    if (canView === undefined) {
      return true;
    }

    return Boolean(canView?.value);
  });

  async function refresh() {
    return resource?.reload?.();
  }

  return Object.freeze({
    record,
    isLoading,
    isFetching,
    isNotFound,
    notFoundError,
    loadError,
    canView: resolvedCanView,
    refresh
  });
}

export { useViewCore };
