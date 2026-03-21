import { computed, watch } from "vue";
import { captureModelSnapshot, restoreModelSnapshot } from "./modelStateHelpers.js";

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
  const modelSnapshot = captureModelSnapshot(model);

  watch(
    () => resource?.query?.isPending?.value,
    (isPending) => {
      if (!isPending || !modelSnapshot) {
        return;
      }

      restoreModelSnapshot(model, modelSnapshot);
    },
    {
      immediate: true
    }
  );

  watch(
    () => resource?.data?.value,
    (payload) => {
      if (!payload || typeof mapLoadedToModel !== "function") {
        return;
      }

      mapLoadedToModel(model, payload, {
        resource
      });
    },
    {
      immediate: true
    }
  );

  const data = resource?.data;
  const record = computed(() => (model !== undefined ? model : data?.value));
  const isLoading = computed(() => Boolean(resource?.query?.isPending?.value));
  const isFetching = computed(() => Boolean(resource?.query?.isFetching?.value));
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
