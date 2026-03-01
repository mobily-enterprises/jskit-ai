import { computed, reactive } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useListPagination } from "./useListPagination.js";
import { useListQueryState } from "./useListQueryState.js";
import { useQueryErrorMessage } from "./useQueryErrorMessage.js";
import { useUrlListPagination } from "./useUrlListPagination.js";

function resolveValue(valueOrGetter, fallback) {
  if (typeof valueOrGetter === "function") {
    const value = valueOrGetter();
    return value == null ? fallback : value;
  }
  return valueOrGetter == null ? fallback : valueOrGetter;
}

function useListRuntime(options = {}) {
  const {
    queryKeyPrefix = [],
    fetchPage,
    pageSizeOptions = [20, 50, 100],
    initialPageSize,
    defaultPageSize,
    useUrlPagination = false,
    pageKey,
    pageSizeKey,
    selectEntries,
    resolveTotalPages,
    handleUnauthorizedError,
    mapError,
    meta: extraMeta = {}
  } = options;

  if (typeof fetchPage !== "function") {
    throw new Error("useListRuntime requires a fetchPage function.");
  }

  const normalizedPageSizeOptions = Array.isArray(pageSizeOptions) && pageSizeOptions.length > 0
    ? pageSizeOptions
    : [20, 50, 100];

  const pagination = useUrlPagination
    ? useUrlListPagination({
        pageKey,
        pageSizeKey,
        pageSizeOptions: normalizedPageSizeOptions,
        initialPageSize,
        defaultPageSize
      })
    : useListPagination({
        initialPage: 1,
        initialPageSize: resolveValue(initialPageSize, normalizedPageSizeOptions[0]),
        defaultPageSize: resolveValue(defaultPageSize, normalizedPageSizeOptions[0])
      });

  const query = useQuery({
    queryKey: computed(() => [
      ...queryKeyPrefix,
      pagination.page.value,
      pagination.pageSize.value
    ]),
    queryFn: () => fetchPage(pagination.page.value, pagination.pageSize.value),
    placeholderData: (previous) => previous
  });

  const entries = computed(() => {
    const source = query.data.value;
    if (typeof selectEntries === "function") {
      return selectEntries(source) || [];
    }
    const rawEntries = source?.entries;
    return Array.isArray(rawEntries) ? rawEntries : [];
  });

  const { total, totalPages, loading } = useListQueryState(query, { resolveTotalPages });

  const error = useQueryErrorMessage({
    query,
    handleUnauthorizedError,
    mapError: typeof mapError === "function"
      ? mapError
      : (nextError) => String(nextError?.message || "Unable to load list data.")
  });

  return {
    meta: {
      pageSizeOptions: normalizedPageSizeOptions,
      ...extraMeta
    },
    state: reactive({
      entries,
      error,
      loading,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages
    }),
    actions: {
      refresh: () => query.refetch(),
      goPrevious: () => pagination.goPrevious({ isLoading: loading.value }),
      goNext: () => pagination.goNext({ totalPages: totalPages.value, isLoading: loading.value }),
      onPageSizeChange: pagination.onPageSizeChange
    }
  };
}

export { useListRuntime };
