import { computed, unref } from "vue";
import { usersWebHttpClient } from "../../lib/httpClient.js";
import { asPlainObject } from "../support/scopeHelpers.js";
import { resolveEnabledRef, resolveTextRef } from "../support/refValueHelpers.js";
import { usePagedCollection } from "../usePagedCollection.js";
import { mergeRequestRecoveryQueryMeta } from "../support/resourceLoadStateHelpers.js";

const DEFAULT_LIST_LIMIT = 20;

function buildListRequestOptions({
  requestOptions = null,
  transport = null,
  pageParam = null
} = {}) {
  const resolvedOptions = {
    method: "GET",
    ...(resolveRequestOptionsObject(requestOptions))
  };

  const sourceQuery =
    resolvedOptions.query && typeof resolvedOptions.query === "object" && !Array.isArray(resolvedOptions.query)
      ? { ...resolvedOptions.query }
      : {};
  if (
    !Object.hasOwn(sourceQuery, "limit") &&
    !Object.hasOwn(sourceQuery, "page[limit]")
  ) {
    sourceQuery.limit = DEFAULT_LIST_LIMIT;
  }
  if (pageParam !== null && pageParam !== undefined && pageParam !== "") {
    sourceQuery.cursor = String(pageParam);
  }
  if (Object.keys(sourceQuery).length > 0) {
    resolvedOptions.query = sourceQuery;
  } else {
    delete resolvedOptions.query;
  }

  if (transport && typeof transport === "object") {
    resolvedOptions.transport = transport;
  }

  return resolvedOptions;
}

function resolveRequestOptionsObject(value = null) {
  const source = unref(value);
  return asPlainObject(source);
}

function resolveListRequestMethod(requestOptions = null) {
  return String(resolveRequestOptionsObject(requestOptions).method || "GET").toUpperCase();
}

function useListCore({
  queryKey,
  path = "",
  enabled = true,
  client = usersWebHttpClient,
  transport = null,
  initialPageParam = null,
  getNextPageParam,
  selectItems,
  requestOptions = null,
  queryOptions = null,
  requestRecovery = null,
  requestRecoveryLabel = "List",
  fallbackLoadError = "Unable to load list."
} = {}) {
  if (!client || typeof client.request !== "function") {
    throw new TypeError("useListCore requires a client with request().");
  }

  const normalizedPath = computed(() => resolveTextRef(path));
  const queryEnabled = computed(() => resolveEnabledRef(enabled) && Boolean(normalizedPath.value));

  const collection = usePagedCollection({
    queryKey,
    initialPageParam,
    enabled: queryEnabled,
    queryFn: async ({ pageParam }) => {
      const requestPath = normalizedPath.value;
      if (!requestPath) {
        throw new Error("List path is required.");
      }

      return client.request(
        requestPath,
        buildListRequestOptions({
          requestOptions,
          transport,
          pageParam
        })
      );
    },
    getNextPageParam,
    selectItems,
    queryOptions: mergeRequestRecoveryQueryMeta(queryOptions, requestRecovery, {
      label: requestRecoveryLabel,
      method: resolveListRequestMethod(requestOptions)
    }),
    fallbackLoadError
  });

  return collection;
}

export {
  buildListRequestOptions,
  useListCore
};
