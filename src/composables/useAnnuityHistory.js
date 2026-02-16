import { computed, onMounted, reactive, ref, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../services/api";
import { useAuthGuard } from "./useAuthGuard";
import { mapHistoryError } from "../features/annuity/errors";
import { pageSizeOptions } from "../features/annuity/formModel";
import { getFirstPage, getNextPage, getPreviousPage, normalizePage, normalizePageSize } from "../utils/pagination";

export const HISTORY_QUERY_KEY_PREFIX = ["history"];

export function useAnnuityHistory({ initialPageSize = pageSizeOptions[0] } = {}) {
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();

  const historyError = ref("");
  const historyPage = ref(getFirstPage());
  const historyPageSize = ref(normalizePageSize(initialPageSize, pageSizeOptions[0]));
  const historyEnabled = ref(false);

  const historyQuery = useQuery({
    queryKey: computed(() => [...HISTORY_QUERY_KEY_PREFIX, historyPage.value, historyPageSize.value]),
    queryFn: () => api.history(historyPage.value, historyPageSize.value),
    enabled: historyEnabled,
    placeholderData: (previous) => previous
  });

  const historyEntries = computed(() => {
    const entries = historyQuery.data.value?.entries;
    return Array.isArray(entries) ? entries : [];
  });

  const historyTotal = computed(() => Number(historyQuery.data.value?.total) || 0);
  const historyTotalPages = computed(() => normalizePage(historyQuery.data.value?.totalPages, 1));
  const historyLoading = computed(() => historyQuery.isPending.value || historyQuery.isFetching.value);

  watch(
    () => historyQuery.error.value,
    async (error) => {
      if (!error) {
        historyError.value = "";
        return;
      }

      if (await handleUnauthorizedError(error)) {
        return;
      }

      historyError.value = mapHistoryError(error).message;
    }
  );

  async function load() {
    await historyQuery.refetch();
  }

  function goPrevious() {
    historyPage.value = getPreviousPage({
      page: historyPage.value,
      isLoading: historyLoading.value
    });
  }

  function goNext() {
    historyPage.value = getNextPage({
      page: historyPage.value,
      totalPages: historyTotalPages.value,
      isLoading: historyLoading.value
    });
  }

  function onPageSizeChange(nextPageSize) {
    if (nextPageSize !== undefined) {
      historyPageSize.value = normalizePageSize(nextPageSize, historyPageSize.value);
    }

    historyPage.value = getFirstPage();
  }

  async function onCalculationCreated() {
    historyPage.value = getFirstPage();
    await queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY_PREFIX });
  }

  onMounted(() => {
    historyEnabled.value = true;
  });

  return reactive({
    pageSizeOptions,
    error: historyError,
    page: historyPage,
    pageSize: historyPageSize,
    enabled: historyEnabled,
    entries: historyEntries,
    total: historyTotal,
    totalPages: historyTotalPages,
    loading: historyLoading,
    load,
    goPrevious,
    goNext,
    onPageSizeChange,
    onCalculationCreated
  });
}
