import { computed } from "vue";
import { useInfiniteQuery } from "@tanstack/vue-query";
import { asPlainObject } from "./scopeHelpers.js";
import { resolveEnabledRef } from "./refValueHelpers.js";
import { toQueryErrorMessage } from "./errorMessageHelpers.js";

function defaultSelectItems(page) {
  return Array.isArray(page?.items) ? page.items : [];
}

function defaultGetNextPageParam(lastPage) {
  return lastPage?.nextCursor ?? null;
}

function usePagedCollection({
  queryKey,
  enabled = true,
  initialPageParam = null,
  queryFn,
  getNextPageParam = defaultGetNextPageParam,
  selectItems = defaultSelectItems,
  dedupeBy = null,
  queryOptions = null,
  fallbackLoadError = "Unable to load list."
} = {}) {
  if (typeof queryFn !== "function") {
    throw new TypeError("usePagedCollection requires queryFn().");
  }
  if (typeof getNextPageParam !== "function") {
    throw new TypeError("usePagedCollection requires getNextPageParam().");
  }
  if (typeof selectItems !== "function") {
    throw new TypeError("usePagedCollection requires selectItems().");
  }
  if (dedupeBy != null && typeof dedupeBy !== "function") {
    throw new TypeError("usePagedCollection dedupeBy must be a function when provided.");
  }

  const queryEnabled = computed(() => resolveEnabledRef(enabled));

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam,
    enabled: queryEnabled,
    queryFn,
    getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) =>
      getNextPageParam(lastPage, allPages, lastPageParam, allPageParams),
    ...(asPlainObject(queryOptions))
  });

  const pages = computed(() => {
    const pageList = query.data.value?.pages;
    return Array.isArray(pageList) ? pageList : [];
  });

  const items = computed(() => {
    const result = [];
    const seen = dedupeBy ? new Set() : null;

    for (const page of pages.value) {
      const pageItems = selectItems(page);
      if (!Array.isArray(pageItems)) {
        continue;
      }

      if (!seen) {
        result.push(...pageItems);
        continue;
      }

      for (const item of pageItems) {
        const key = dedupeBy(item);
        const normalizedKey = String(key ?? "").trim();
        if (!normalizedKey) {
          result.push(item);
          continue;
        }
        if (seen.has(normalizedKey)) {
          continue;
        }
        seen.add(normalizedKey);
        result.push(item);
      }
    }

    return result;
  });

  const isInitialLoading = computed(() => Boolean(query.isPending.value));
  const isFetching = computed(() => Boolean(query.isFetching.value));
  const isRefetching = computed(() => Boolean(isFetching.value && !isInitialLoading.value));
  const isLoading = computed(() => Boolean(isInitialLoading.value || isFetching.value));
  const isLoadingMore = computed(() => Boolean(query.isFetchingNextPage.value));
  const hasMore = computed(() => Boolean(query.hasNextPage.value));
  const loadError = computed(() => toQueryErrorMessage(query.error.value, fallbackLoadError, "Unable to load list."));

  async function reload() {
    return query.refetch();
  }

  async function loadMore() {
    if (!hasMore.value || isLoadingMore.value) {
      return null;
    }

    return query.fetchNextPage();
  }

  return Object.freeze({
    query,
    pages,
    items,
    isInitialLoading,
    isFetching,
    isRefetching,
    isLoading,
    isLoadingMore,
    hasMore,
    loadError,
    reload,
    loadMore
  });
}

export { usePagedCollection };
