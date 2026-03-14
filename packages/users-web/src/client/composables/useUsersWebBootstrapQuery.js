import {
  computed
} from "vue";
import { useQuery } from "@tanstack/vue-query";
import { normalizeQueryToken } from "@jskit-ai/kernel/shared/support/normalize";
import { usersWebHttpClient } from "../lib/httpClient.js";
import { buildBootstrapApiPath } from "../lib/bootstrap.js";
import { resolveEnabledRef, resolveTextRef } from "./refValueHelpers.js";

function useUsersWebBootstrapQuery({ workspaceSlug = "", enabled = true, staleTime = 0 } = {}) {
  const normalizedWorkspaceSlug = computed(() => resolveTextRef(workspaceSlug));
  const queryKey = computed(() => ["users-web", "bootstrap", normalizeQueryToken(normalizedWorkspaceSlug.value)]);
  const bootstrapPath = computed(() => buildBootstrapApiPath(normalizedWorkspaceSlug.value));
  const queryEnabled = computed(() => resolveEnabledRef(enabled));

  const query = useQuery({
    queryKey,
    queryFn: () =>
      usersWebHttpClient.request(bootstrapPath.value, {
        method: "GET"
      }),
    enabled: queryEnabled,
    staleTime
  });

  return Object.freeze({
    query,
    queryKey,
    workspaceSlug: normalizedWorkspaceSlug
  });
}

export { useUsersWebBootstrapQuery };
