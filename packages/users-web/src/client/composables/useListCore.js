import { computed } from "vue";
import { appendQueryString } from "@jskit-ai/kernel/shared/support";
import { usersWebHttpClient } from "../lib/httpClient.js";
import { asPlainObject } from "./scopeHelpers.js";
import { resolveEnabledRef, resolveTextRef } from "./refValueHelpers.js";
import { usePagedCollection } from "./usePagedCollection.js";

function appendPageParam(path, pageParam) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    return "";
  }
  if (pageParam === null || pageParam === undefined || pageParam === "") {
    return normalizedPath;
  }

  const query = new URLSearchParams();
  query.set("cursor", String(pageParam));
  return appendQueryString(normalizedPath, query.toString());
}

function useListCore({
  queryKey,
  path = "",
  enabled = true,
  client = usersWebHttpClient,
  initialPageParam = null,
  getNextPageParam,
  selectItems,
  requestOptions = null,
  queryOptions = null,
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
      const requestPath = appendPageParam(normalizedPath.value, pageParam);
      if (!requestPath) {
        throw new Error("List path is required.");
      }

      return client.request(requestPath, {
        method: "GET",
        ...(asPlainObject(requestOptions))
      });
    },
    getNextPageParam,
    selectItems,
    queryOptions,
    fallbackLoadError
  });

  return collection;
}

export { useListCore };
