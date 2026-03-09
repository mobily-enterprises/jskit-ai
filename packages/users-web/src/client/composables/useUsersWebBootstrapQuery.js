import { computed, unref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { usersWebHttpClient } from "../lib/httpClient.js";
import { buildBootstrapApiPath } from "../lib/bootstrap.js";
import { USERS_WEB_QUERY_KEYS } from "../lib/queryKeys.js";

function resolveWorkspaceSlug(value) {
  return String(unref(value) || "").trim();
}

function resolveEnabled(value) {
  if (value === undefined) {
    return true;
  }
  return Boolean(unref(value));
}

function useUsersWebBootstrapQuery({ workspaceSlug = "", enabled = true, staleTime = 0 } = {}) {
  const normalizedWorkspaceSlug = computed(() => resolveWorkspaceSlug(workspaceSlug));
  const queryKey = computed(() => USERS_WEB_QUERY_KEYS.bootstrap(normalizedWorkspaceSlug.value));
  const queryEnabled = computed(() => resolveEnabled(enabled));

  const query = useQuery({
    queryKey,
    queryFn: () =>
      usersWebHttpClient.request(buildBootstrapApiPath(normalizedWorkspaceSlug.value), {
        method: "GET"
      }),
    enabled: queryEnabled,
    staleTime,
    refetchOnWindowFocus: false
  });

  return Object.freeze({
    query,
    queryKey,
    workspaceSlug: normalizedWorkspaceSlug
  });
}

export { useUsersWebBootstrapQuery };
