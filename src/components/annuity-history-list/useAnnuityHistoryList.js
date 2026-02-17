import { computed, onMounted, reactive, ref, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../../services/api";
import { useAuthGuard } from "../../composables/useAuthGuard";
import { useListPagination } from "../../composables/useListPagination";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { mapHistoryError } from "../../features/annuity/errors";
import { pageSizeOptions } from "../../features/annuity/formModel";
import { normalizePage } from "../../utils/pagination";

export const HISTORY_QUERY_KEY_PREFIX = ["history"];

export function useAnnuityHistoryList({ initialPageSize = pageSizeOptions[0] } = {}) {
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();
  const workspaceStore = useWorkspaceStore();
  const pagination = useListPagination({
    initialPageSize,
    defaultPageSize: pageSizeOptions[0],
    getIsLoading: () => historyLoading.value,
    getTotalPages: () => historyTotalPages.value
  });

  const historyError = ref("");
  const historyEnabled = ref(false);

  const historyQuery = useQuery({
    queryKey: computed(() => [
      ...HISTORY_QUERY_KEY_PREFIX,
      workspaceStore.activeWorkspaceSlug || "none",
      pagination.page.value,
      pagination.pageSize.value
    ]),
    queryFn: () => api.history(pagination.page.value, pagination.pageSize.value),
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

  async function onCalculationCreated() {
    pagination.resetToFirstPage();
    await queryClient.invalidateQueries({
      queryKey: [...HISTORY_QUERY_KEY_PREFIX, workspaceStore.activeWorkspaceSlug || "none"]
    });
  }

  onMounted(() => {
    historyEnabled.value = true;
  });

  return reactive({
    pageSizeOptions,
    error: historyError,
    page: pagination.page,
    pageSize: pagination.pageSize,
    enabled: historyEnabled,
    entries: historyEntries,
    total: historyTotal,
    totalPages: historyTotalPages,
    loading: historyLoading,
    load,
    goPrevious: pagination.goPrevious,
    goNext: pagination.goNext,
    onPageSizeChange: pagination.onPageSizeChange,
    onCalculationCreated
  });
}
