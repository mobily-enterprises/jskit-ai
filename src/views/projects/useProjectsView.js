import { computed, reactive } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import { mapProjectsError } from "../../features/projects/errors.js";
import { PROJECT_QUERY_KEY_PREFIX } from "./queryKeys.js";

function resolveProjectIdFromPath(pathname) {
  const match = String(pathname || "").match(/\/projects\/([^/]+)/i);
  if (!match) {
    return "";
  }

  return decodeURIComponent(String(match[1] || "")).trim();
}

export function useProjectsView() {
  const navigate = useNavigate();
  const workspaceStore = useWorkspaceStore();
  const { handleUnauthorizedError } = useAuthGuard();

  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });

  const projectId = computed(() => resolveProjectIdFromPath(routerPath.value));
  const workspaceScope = computed(() => workspaceStore.activeWorkspaceSlug || "none");
  const enabled = computed(() => Boolean(workspaceStore.initialized && workspaceStore.activeWorkspaceSlug && projectId.value));

  const query = useQuery({
    queryKey: computed(() => [...PROJECT_QUERY_KEY_PREFIX, workspaceScope.value, projectId.value || "none"]),
    queryFn: () => api.workspaceProject(projectId.value),
    enabled
  });

  const project = computed(() => {
    const source = query.data.value?.project;
    return source && typeof source === "object" ? source : null;
  });

  const loading = computed(() => Boolean(query.isPending.value || query.isFetching.value));

  const error = useQueryErrorMessage({
    query,
    handleUnauthorizedError,
    mapError: (nextError) => mapProjectsError(nextError, "Unable to load project.")
  });

  function workspacePath(suffix) {
    return workspaceStore.workspacePath(suffix, {
      surface: "admin"
    });
  }

  return {
    state: reactive({
      projectId,
      project,
      loading,
      error
    }),
    actions: {
      refresh: () => query.refetch(),
      goBack: () =>
        navigate({
          to: workspacePath("/projects")
        }),
      goToEdit: () => {
        if (!projectId.value) {
          return Promise.resolve();
        }

        return navigate({
          to: workspacePath(`/projects/${encodeURIComponent(projectId.value)}/edit`)
        });
      }
    }
  };
}
