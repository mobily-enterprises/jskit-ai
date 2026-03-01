import { computed, reactive } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../platform/http/api/index.js";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";
import { mapProjectsError } from "../../modules/projects/errors.js";
import { projectDetailQueryKey } from "../../modules/projects/queryKeys.js";
import { buildProjectsRouteSuffix, resolveProjectIdFromPath } from "./routePaths.js";
import { workspacePathForProjects } from "./projectsWorkspacePath.js";

export function useProjectsView() {
  const navigate = useNavigate();
  const workspaceStore = useWorkspaceStore();
  const { handleUnauthorizedError } = useAuthGuard();

  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });

  const projectId = computed(() => resolveProjectIdFromPath(routerPath.value));
  const workspaceScope = computed(() => workspaceStore.activeWorkspaceSlug || "none");
  const enabled = computed(() =>
    Boolean(workspaceStore.initialized && workspaceStore.activeWorkspaceSlug && projectId.value)
  );

  const query = useQuery({
    queryKey: computed(() => projectDetailQueryKey(workspaceScope.value, projectId.value || "none")),
    queryFn: () => api.projects.get(projectId.value),
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
          to: workspacePathForProjects(workspaceStore, buildProjectsRouteSuffix())
        }),
      goToEdit: () => {
        if (!projectId.value) {
          return Promise.resolve();
        }

        return navigate({
          to: workspacePathForProjects(workspaceStore, buildProjectsRouteSuffix(`/${encodeURIComponent(projectId.value)}/edit`))
        });
      }
    }
  };
}
