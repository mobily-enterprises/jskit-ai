import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core/server";
import { api } from "../../platform/http/api/index.js";

function formatMoney(amountMinor, currency) {
  const amount = Number(amountMinor || 0);
  const normalizedCurrency = String(currency || "USD")
    .trim()
    .toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${normalizedCurrency}`;
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

export function useConsoleBillingPurchasesView() {
  const { handleUnauthorizedError } = useAuthGuard();
  const query = useQuery({
    queryKey: ["console", "billing", "purchases"],
    queryFn: () =>
      api.console.listPurchases({
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
    mapError: (nextError) => String(nextError?.message || "Unable to load purchases.")
  });

  return {
    entries,
    queryPending,
    queryError,
    formatMoney,
    formatDate
  };
}
