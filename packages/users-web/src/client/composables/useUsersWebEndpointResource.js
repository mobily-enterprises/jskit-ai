import { computed, unref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { usersWebHttpClient } from "../lib/httpClient.js";

function resolveEnabled(value) {
  if (value === undefined) {
    return true;
  }

  return Boolean(unref(value));
}

function resolvePath(value) {
  return String(unref(value) || "").trim();
}

function toErrorMessage(error, fallback) {
  if (!error) {
    return "";
  }

  return String(error?.message || fallback || "Request failed.").trim();
}

function asPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function useUsersWebEndpointResource({
  queryKey,
  path = "",
  enabled = true,
  client = usersWebHttpClient,
  readMethod = "GET",
  writeMethod = "PATCH",
  queryOptions = null,
  mutationOptions = null,
  fallbackLoadError = "Unable to load resource.",
  fallbackSaveError = "Unable to save resource."
} = {}) {
  if (!client || typeof client.request !== "function") {
    throw new TypeError("useUsersWebEndpointResource requires a client with request().");
  }

  const normalizedPath = computed(() => resolvePath(path));
  const queryEnabled = computed(() => resolveEnabled(enabled) && Boolean(normalizedPath.value));

  const query = useQuery({
    queryKey,
    queryFn: () => {
      const requestPath = normalizedPath.value;
      if (!requestPath) {
        throw new Error("Resource path is required.");
      }

      return client.request(requestPath, {
        method: String(readMethod || "GET").toUpperCase()
      });
    },
    enabled: queryEnabled,
    ...(asPlainObject(queryOptions))
  });

  const mutation = useMutation({
    mutationFn: async (request = {}) => {
      const options = asPlainObject(request);
      const requestPath = resolvePath(options.path || normalizedPath.value);
      if (!requestPath) {
        throw new Error("Resource path is required.");
      }

      const method = String(options.method || writeMethod || "PATCH").toUpperCase();
      const hasBody = Object.prototype.hasOwnProperty.call(options, "body");
      const body = hasBody ? options.body : options.payload;
      const requestOptions = {
        method,
        ...(asPlainObject(options.options))
      };

      if (body !== undefined) {
        requestOptions.body = body;
      }

      return client.request(requestPath, requestOptions);
    },
    ...(asPlainObject(mutationOptions))
  });

  const data = computed(() => query.data.value);
  const isLoading = computed(() => Boolean(queryEnabled.value && (query.isPending.value || query.isFetching.value)));
  const isSaving = computed(() => Boolean(mutation.isPending.value));
  const loadError = computed(() => toErrorMessage(query.error.value, fallbackLoadError));
  const saveError = computed(() => toErrorMessage(mutation.error.value, fallbackSaveError));

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
    isLoading,
    isSaving,
    loadError,
    saveError,
    reload,
    save
  });
}

export { useUsersWebEndpointResource };
