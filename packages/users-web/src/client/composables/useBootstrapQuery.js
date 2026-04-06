import {
  computed
} from "vue";
import { useQuery } from "@tanstack/vue-query";
import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { usersWebHttpClient } from "../lib/httpClient.js";
import { buildBootstrapApiPath } from "../lib/bootstrap.js";
import { resolveEnabledRef, resolveTextRef } from "./support/refValueHelpers.js";

const DEFAULT_BOOTSTRAP_STALE_TIME_MS = 60_000;

function normalizeStaleTime(value, fallback = DEFAULT_BOOTSTRAP_STALE_TIME_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function useBootstrapQuery({
  workspaceSlug = "",
  enabled = true,
  staleTime = DEFAULT_BOOTSTRAP_STALE_TIME_MS,
  refetchOnMount = false,
  refetchOnWindowFocus = false
} = {}) {
  const normalizedWorkspaceSlug = computed(() => resolveTextRef(workspaceSlug));
  const queryKey = computed(() => ["users-web", "bootstrap", normalizeQueryToken(normalizedWorkspaceSlug.value)]);
  const bootstrapPath = computed(() => buildBootstrapApiPath(normalizedWorkspaceSlug.value));
  const queryEnabled = computed(() => resolveEnabledRef(enabled));
  const queryStaleTime = normalizeStaleTime(staleTime, DEFAULT_BOOTSTRAP_STALE_TIME_MS);

  const query = useQuery({
    queryKey,
    queryFn: () =>
      usersWebHttpClient.request(bootstrapPath.value, {
        method: "GET"
      }),
    enabled: queryEnabled,
    staleTime: queryStaleTime,
    refetchOnMount,
    refetchOnWindowFocus
  });

  return Object.freeze({
    query,
    queryKey,
    workspaceSlug: normalizedWorkspaceSlug
  });
}

export { useBootstrapQuery };
