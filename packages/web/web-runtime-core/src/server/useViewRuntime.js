import { computed, reactive } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useQueryErrorMessage } from "./useQueryErrorMessage.js";

function resolveValue(valueOrGetter) {
  if (typeof valueOrGetter === "function") {
    return valueOrGetter();
  }
  return valueOrGetter;
}

function useViewRuntime(options = {}) {
  const {
    queryKeyPrefix = [],
    fetchEntry,
    getId,
    selectEntry,
    handleUnauthorizedError,
    mapError
  } = options;

  if (typeof fetchEntry !== "function") {
    throw new Error("useViewRuntime requires a fetchEntry function.");
  }

  const id = computed(() => resolveValue(getId));
  const hasValidId = computed(() => id.value != null && String(id.value).trim() !== "");

  const query = useQuery({
    queryKey: computed(() => [...queryKeyPrefix, id.value || "none"]),
    enabled: hasValidId,
    queryFn: () => fetchEntry(id.value)
  });

  const entry = computed(() => {
    const source = query.data.value;
    if (typeof selectEntry === "function") {
      return selectEntry(source);
    }
    return source?.entry ?? source ?? null;
  });

  const error = useQueryErrorMessage({
    query,
    handleUnauthorizedError,
    mapError: typeof mapError === "function"
      ? mapError
      : (nextError) => String(nextError?.message || "Unable to load record.")
  });

  return {
    state: reactive({
      entry,
      error,
      loading: computed(() => Boolean(query.isPending?.value || query.isFetching?.value)),
      hasEntry: computed(() => Boolean(entry.value))
    }),
    actions: {
      refresh: () => query.refetch()
    }
  };
}

export { useViewRuntime };
