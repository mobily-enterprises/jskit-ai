import { computed, reactive } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../../services/api";
import { useAuthGuard } from "../../composables/useAuthGuard";
import { useListQueryState } from "../../composables/useListQueryState";
import { useUrlListPagination } from "../../composables/useUrlListPagination";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { mapHistoryError } from "../../features/annuity/errors";
import { pageSizeOptions } from "../../features/annuity/formModel";

export const HISTORY_QUERY_KEY_PREFIX = ["history"];
export const HISTORY_PAGE_QUERY_KEY = "historyPage";
export const HISTORY_PAGE_SIZE_QUERY_KEY = "historyPageSize";

export function useAnnuityHistoryList({ initialPageSize = pageSizeOptions[0] } = {}) {
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();
  const workspaceStore = useWorkspaceStore();
  const enabled = computed(() => Boolean(workspaceStore.initialized && workspaceStore.activeWorkspaceSlug));
  const pagination = useUrlListPagination({
    pageKey: HISTORY_PAGE_QUERY_KEY,
    pageSizeKey: HISTORY_PAGE_SIZE_QUERY_KEY,
    initialPageSize,
    defaultPageSize: pageSizeOptions[0],
    pageSizeOptions
  });

  const query = useQuery({
    queryKey: computed(() => [
      ...HISTORY_QUERY_KEY_PREFIX,
      workspaceStore.activeWorkspaceSlug || "none",
      pagination.page.value,
      pagination.pageSize.value
    ]),
    queryFn: () => api.history(pagination.page.value, pagination.pageSize.value),
    enabled,
    placeholderData: (previous) => previous
  });

  const entries = computed(() => {
    const resultEntries = query.data.value?.entries;
    return Array.isArray(resultEntries) ? resultEntries : [];
  });

  const { total, totalPages, loading } = useListQueryState(query);

  const error = useQueryErrorMessage({
    query,
    handleUnauthorizedError,
    mapError: mapHistoryError
  });

  async function onCalculationCreated() {
    pagination.resetToFirstPage();
    await queryClient.invalidateQueries({
      queryKey: [...HISTORY_QUERY_KEY_PREFIX, workspaceStore.activeWorkspaceSlug || "none"]
    });
  }

  return {
    meta: {
      pageSizeOptions
    },
    state: reactive({
      error,
      page: pagination.page,
      pageSize: pagination.pageSize,
      enabled,
      entries,
      total,
      totalPages,
      loading
    }),
    actions: {
      load: () => query.refetch(),
      goPrevious: () => pagination.goPrevious({ isLoading: loading.value }),
      goNext: () => pagination.goNext({ totalPages: totalPages.value, isLoading: loading.value }),
      onPageSizeChange: pagination.onPageSizeChange,
      onCalculationCreated
    }
  };
}
