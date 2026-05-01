import { computed, unref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { usersWebHttpClient } from "../../lib/httpClient.js";
import { asPlainObject } from "../support/scopeHelpers.js";
import { resolveEnabledRef, resolveTextRef } from "../support/refValueHelpers.js";
import { toQueryErrorMessage } from "../support/errorMessageHelpers.js";
import { hasResolvedQueryData } from "../support/resourceLoadStateHelpers.js";

function buildEndpointReadRequestOptions({
  method = "GET",
  query = null,
  transport = null
} = {}) {
  const requestOptions = {
    method: String(method || "GET").toUpperCase()
  };

  const normalizedQuery = resolveRequestQuery(query);
  if (normalizedQuery) {
    requestOptions.query = normalizedQuery;
  }

  if (transport && typeof transport === "object") {
    requestOptions.transport = transport;
  }

  return requestOptions;
}

function resolveRequestQuery(value = null) {
  const source = unref(value);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  return source;
}

function buildEndpointWriteRequestOptions({
  method = "PATCH",
  body = undefined,
  options = null,
  transport = null
} = {}) {
  const requestOptions = {
    method: String(method || "PATCH").toUpperCase(),
    ...(asPlainObject(options))
  };

  if (body !== undefined) {
    requestOptions.body = body;
  }

  if (transport && typeof transport === "object") {
    requestOptions.transport = transport;
  }

  return requestOptions;
}

function useEndpointResource({
  queryKey,
  path = "",
  enabled = true,
  client = usersWebHttpClient,
  readMethod = "GET",
  writeMethod = "PATCH",
  readQuery = null,
  transport = null,
  queryOptions = null,
  mutationOptions = null,
  fallbackLoadError = "Unable to load resource.",
  fallbackSaveError = "Unable to save resource."
} = {}) {
  if (!client || typeof client.request !== "function") {
    throw new TypeError("useEndpointResource requires a client with request().");
  }

  const normalizedPath = computed(() => resolveTextRef(path));
  const queryEnabled = computed(() => resolveEnabledRef(enabled) && Boolean(normalizedPath.value));

  const query = useQuery({
    queryKey,
    queryFn: () => {
      const requestPath = normalizedPath.value;
      if (!requestPath) {
        throw new Error("Resource path is required.");
      }

      return client.request(requestPath, {
        ...buildEndpointReadRequestOptions({
          method: readMethod,
          query: readQuery,
          transport
        })
      });
    },
    enabled: queryEnabled,
    ...(asPlainObject(queryOptions))
  });

  const mutation = useMutation({
    mutationFn: async (request = {}) => {
      const options = asPlainObject(request);
      const requestPath = resolveTextRef(options.path || normalizedPath.value);
      if (!requestPath) {
        throw new Error("Resource path is required.");
      }

      const method = String(options.method || writeMethod || "PATCH").toUpperCase();
      const hasBody = Object.hasOwn(options, "body");
      const body = hasBody ? options.body : options.payload;
      return client.request(
        requestPath,
        buildEndpointWriteRequestOptions({
          method,
          body,
          options: options.options,
          transport
        })
      );
    },
    ...(asPlainObject(mutationOptions))
  });

  const data = computed(() => query.data.value);
  const hasResolvedData = computed(() => hasResolvedQueryData({
    query,
    data
  }));
  const isInitialLoading = computed(() => Boolean(queryEnabled.value && query.isPending.value && !hasResolvedData.value));
  const isFetching = computed(() => Boolean(queryEnabled.value && query.isFetching.value));
  const isRefetching = computed(() => Boolean(isFetching.value && !isInitialLoading.value));
  const isLoading = computed(() => Boolean(isInitialLoading.value || isFetching.value));
  const isSaving = computed(() => Boolean(mutation.isPending.value));
  const loadError = computed(() => toQueryErrorMessage(query.error.value, fallbackLoadError, "Request failed."));
  const saveError = computed(() => toQueryErrorMessage(mutation.error.value, fallbackSaveError, "Request failed."));

  async function reload() {
    return query.refetch();
  }

  async function save(payload, options = {}) {
    return mutation.mutateAsync({
      ...asPlainObject(options),
      payload
    });
  }

  return Object.freeze({
    query,
    mutation,
    data,
    isInitialLoading,
    isFetching,
    isRefetching,
    isLoading,
    isSaving,
    loadError,
    saveError,
    reload,
    save
  });
}

export {
  buildEndpointReadRequestOptions,
  buildEndpointWriteRequestOptions,
  useEndpointResource
};
