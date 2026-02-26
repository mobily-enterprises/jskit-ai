import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core";
import { api } from "../../platform/http/api/index.js";

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

export function useConsoleBillingSubscriptionsView() {
  const { handleUnauthorizedError } = useAuthGuard();
  const query = useQuery({
    queryKey: ["console", "billing", "subscriptions"],
    queryFn: () =>
      api.console.listSubscriptions({
        page: 1,
        pageSize: 50
      })
  });

  const entries = computed(() => {
    const value = Array.isArray(query.data.value?.entries) ? query.data.value.entries : [];
    return value;
  });
  const queryPending = computed(() => Boolean(query.isPending.value || query.isFetching.value));
  const queryError = useQueryErrorMessage({
    query,
    handleUnauthorizedError,
    mapError: (nextError) => String(nextError?.message || "Unable to load subscriptions.")
  });

  return {
    entries,
    queryPending,
    queryError,
    formatDate
  };
}
