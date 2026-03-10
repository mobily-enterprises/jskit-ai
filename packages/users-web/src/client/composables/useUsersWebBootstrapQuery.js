import {
  computed,
  unref,
  watch
} from "vue";
import { useQuery } from "@tanstack/vue-query";
import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { usersWebHttpClient } from "../lib/httpClient.js";
import { buildBootstrapApiPath } from "../lib/bootstrap.js";

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
  const queryKey = computed(() => ["users-web", "bootstrap", normalizeQueryToken(normalizedWorkspaceSlug.value)]);
  const bootstrapPath = computed(() => buildBootstrapApiPath(normalizedWorkspaceSlug.value));
  const queryEnabled = computed(() => resolveEnabled(enabled));

  const query = useQuery({
    queryKey,
    queryFn: () =>
      usersWebHttpClient.request(bootstrapPath.value, {
        method: "GET"
      }),
    enabled: queryEnabled,
    staleTime,
    refetchOnWindowFocus: false
  });

  watch(
    [normalizedWorkspaceSlug, bootstrapPath, queryEnabled, () => query.error.value, () => query.data.value],
    ([nextWorkspaceSlug, nextBootstrapPath, nextQueryEnabled, nextError, nextData]) => {
      console.log("[users-web-debug] bootstrap-query", {
        workspaceSlug: nextWorkspaceSlug,
        path: nextBootstrapPath,
        enabled: nextQueryEnabled,
        error: nextError
          ? {
              name: nextError.name,
              message: nextError.message,
              status: nextError.status,
              statusCode: nextError.statusCode,
              code: nextError.code,
              details: nextError.details
            }
          : null,
        activeWorkspaceSlug: String(nextData?.activeWorkspace?.slug || "").trim(),
        permissions: Array.isArray(nextData?.permissions) ? nextData.permissions : []
      });
    },
    { immediate: true }
  );

  return Object.freeze({
    query,
    queryKey,
    workspaceSlug: normalizedWorkspaceSlug
  });
}

export { useUsersWebBootstrapQuery };
