import { computed, unref } from "vue";
import { useInfiniteQuery } from "@tanstack/vue-query";
import { usersWebHttpClient } from "../lib/httpClient.js";
import { asPlainObject } from "./scopeHelpers.js";

function resolveEnabled(value) {
  if (value === undefined) {
    return true;
  }

  return Boolean(unref(value));
}

function resolvePath(value) {
  return String(unref(value) || "").trim();
}

function appendPageParam(path, paramName, pageParam) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    return "";
  }
  if (pageParam === null || pageParam === undefined || pageParam === "") {
    return normalizedPath;
  }

  const query = new URLSearchParams();
  query.set(String(paramName || "cursor"), String(pageParam));
  return `${normalizedPath}${normalizedPath.includes("?") ? "&" : "?"}${query.toString()}`;
}

function toErrorMessage(error, fallback) {
  if (!error) {
    return "";
  }

  return String(error?.message || fallback || "Unable to load list.").trim();
}

function defaultSelectItems(page) {
  return Array.isArray(page?.items) ? page.items : [];
}

function defaultGetNextPageParam(lastPage) {
  return lastPage?.nextCursor ?? null;
}

function useListCore({
  queryKey,
  path = "",
  enabled = true,
  client = usersWebHttpClient,
  pageParamName = "cursor",
  initialPageParam = null,
  getNextPageParam = defaultGetNextPageParam,
  selectItems = defaultSelectItems,
  requestOptions = null,
  queryOptions = null,
  fallbackLoadError = "Unable to load list."
} = {}) {
  if (!client || typeof client.request !== "function") {
    throw new TypeError("useListCore requires a client with request().");
  }
  if (typeof getNextPageParam !== "function") {
    throw new TypeError("useListCore requires getNextPageParam().");
  }
  if (typeof selectItems !== "function") {
    throw new TypeError("useListCore requires selectItems().");
  }

  const normalizedPath = computed(() => resolvePath(path));
  const queryEnabled = computed(() => resolveEnabled(enabled) && Boolean(normalizedPath.value));

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam,
    enabled: queryEnabled,
    queryFn: async ({ pageParam }) => {
      const requestPath = appendPageParam(normalizedPath.value, pageParamName, pageParam);
      if (!requestPath) {
        throw new Error("List path is required.");
      }

      return client.request(requestPath, {
        method: "GET",
        ...(asPlainObject(requestOptions))
      });
    },
    getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) =>
      getNextPageParam(lastPage, allPages, lastPageParam, allPageParams),
    refetchOnWindowFocus: false,
    ...(asPlainObject(queryOptions))
  });

  const pages = computed(() => {
    const pageList = query.data.value?.pages;
    return Array.isArray(pageList) ? pageList : [];
  });

  const items = computed(() => {
    const result = [];
    for (const page of pages.value) {
      const pageItems = selectItems(page);
      if (Array.isArray(pageItems)) {
        result.push(...pageItems);
      }
    }
    return result;
  });

  const isLoading = computed(() => Boolean(query.isPending.value || query.isFetching.value));
  const isLoadingMore = computed(() => Boolean(query.isFetchingNextPage.value));
  const hasMore = computed(() => Boolean(query.hasNextPage.value));
  const loadError = computed(() => toErrorMessage(query.error.value, fallbackLoadError));

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
    isLoading,
    isLoadingMore,
    hasMore,
    loadError,
    reload,
    loadMore
  });
}

export { useListCore };
