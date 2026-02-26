import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core";
import { api } from "../../platform/http/api/index.js";

export function useConsoleBillingEntitlementsView() {
  const { handleUnauthorizedError } = useAuthGuard();
  const query = useQuery({
    queryKey: ["console", "billing", "entitlement-definitions"],
    queryFn: () => api.console.listEntitlementDefinitions({ includeInactive: true })
  });

  const entries = computed(() => {
    const value = Array.isArray(query.data.value?.entries) ? query.data.value.entries : [];
    return value;
  });
  const queryPending = computed(() => Boolean(query.isPending.value || query.isFetching.value));
  const queryError = useQueryErrorMessage({
    query,
    handleUnauthorizedError,
    mapError: (nextError) => String(nextError?.message || "Unable to load entitlement definitions.")
  });

  return {
    entries,
    queryPending,
    queryError
  };
}
