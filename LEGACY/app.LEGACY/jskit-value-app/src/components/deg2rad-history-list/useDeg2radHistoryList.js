import { computed, reactive } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../../platform/http/api/index.js";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";
import { useListQueryState } from "@jskit-ai/web-runtime-core/useListQueryState";
import { useStandardListPagination } from "../../modules/pagination/useStandardListPagination.js";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core/server";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";
import { mapHistoryError } from "../../modules/deg2rad/errors.js";
import { pageSizeOptions } from "../../modules/deg2rad/formModel.js";

export const HISTORY_QUERY_KEY_PREFIX = ["history"];

export function useDeg2radHistoryList({ initialPageSize = pageSizeOptions[0] } = {}) {
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();
  const workspaceStore = useWorkspaceStore();
  const enabled = computed(() => Boolean(workspaceStore.initialized && workspaceStore.activeWorkspaceSlug));
  const pagination = useStandardListPagination({
    keyPrefix: "history",
    initialPageSize,
    pageSizeOptions
  });

  const query = useQuery({
    queryKey: computed(() => [
      ...HISTORY_QUERY_KEY_PREFIX,
      workspaceStore.activeWorkspaceSlug || "none",
      pagination.page.value,
      pagination.pageSize.value
    ]),
    queryFn: () => api.history.list(pagination.page.value, pagination.pageSize.value),
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
