import { computed, reactive } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useListQueryState } from "../../composables/useListQueryState.js";
import { useUrlListPagination } from "../../composables/useUrlListPagination.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import { mapProjectsError } from "../../features/projects/errors.js";
import { projectPageSizeOptions } from "../../features/projects/formModel.js";
import {
  PROJECTS_QUERY_KEY_PREFIX,
  PROJECTS_PAGE_QUERY_KEY,
  PROJECTS_PAGE_SIZE_QUERY_KEY
} from "./queryKeys.js";

export function useProjectsList({ initialPageSize = projectPageSizeOptions[0] } = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { handleUnauthorizedError } = useAuthGuard();
  const workspaceStore = useWorkspaceStore();

  const enabled = computed(() => Boolean(workspaceStore.initialized && workspaceStore.activeWorkspaceSlug));

  const pagination = useUrlListPagination({
    pageKey: PROJECTS_PAGE_QUERY_KEY,
    pageSizeKey: PROJECTS_PAGE_SIZE_QUERY_KEY,
    initialPageSize,
    defaultPageSize: projectPageSizeOptions[0],
    pageSizeOptions: projectPageSizeOptions
  });

  const workspaceScope = computed(() => workspaceStore.activeWorkspaceSlug || "none");

  const query = useQuery({
    queryKey: computed(() => [
      ...PROJECTS_QUERY_KEY_PREFIX,
      workspaceScope.value,
      pagination.page.value,
      pagination.pageSize.value
    ]),
    queryFn: () => api.workspaceProjects(pagination.page.value, pagination.pageSize.value),
    enabled,
    placeholderData: (previous) => previous
  });

  const entries = computed(() => {
    const source = query.data.value?.entries;
    return Array.isArray(source) ? source : [];
  });

  const { total, totalPages, loading } = useListQueryState(query);

  const error = useQueryErrorMessage({
    query,
    handleUnauthorizedError,
    mapError: (nextError) => mapProjectsError(nextError, "Unable to load projects.")
  });

  function workspacePath(suffix) {
    return workspaceStore.workspacePath(suffix, {
      surface: "admin"
    });
  }

  async function onProjectSaved() {
    await queryClient.invalidateQueries({
      queryKey: [...PROJECTS_QUERY_KEY_PREFIX, workspaceScope.value]
    });
  }

  return {
    meta: {
      pageSizeOptions: projectPageSizeOptions
    },
    state: reactive({
      error,
      entries,
      enabled,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages,
      loading
    }),
    actions: {
      load: () => query.refetch(),
      goPrevious: () => pagination.goPrevious({ isLoading: loading.value }),
      goNext: () => pagination.goNext({ totalPages: totalPages.value, isLoading: loading.value }),
      onPageSizeChange: pagination.onPageSizeChange,
      goToAdd: () =>
        navigate({
          to: workspacePath("/projects/add")
        }),
      goToView: (projectId) =>
        navigate({
          to: workspacePath(`/projects/${encodeURIComponent(String(projectId || ""))}`)
        }),
      goToEdit: (projectId) =>
        navigate({
          to: workspacePath(`/projects/${encodeURIComponent(String(projectId || ""))}/edit`)
        }),
      onProjectSaved
    }
  };
}
