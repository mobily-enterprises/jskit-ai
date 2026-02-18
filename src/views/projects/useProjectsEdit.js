import { computed, reactive, ref, watch } from "vue";
import { useNavigate, useRouterState } from "@tanstack/vue-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { useQueryErrorMessage } from "../../composables/useQueryErrorMessage.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import { mapProjectsError } from "../../features/projects/errors.js";
import { createDefaultProjectForm, projectStatusOptions } from "../../features/projects/formModel.js";
import { PROJECT_QUERY_KEY_PREFIX, PROJECTS_QUERY_KEY_PREFIX } from "./queryKeys.js";

function resolveProjectIdFromPath(pathname) {
  const match = String(pathname || "").match(/\/projects\/([^/]+)/i);
  if (!match) {
    return "";
  }

  return decodeURIComponent(String(match[1] || "")).trim();
}

export function useProjectsEdit() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceStore = useWorkspaceStore();
  const { handleUnauthorizedError } = useAuthGuard();

  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });

  const form = reactive(createDefaultProjectForm());
  const projectId = computed(() => resolveProjectIdFromPath(routerPath.value));
  const workspaceScope = computed(() => workspaceStore.activeWorkspaceSlug || "none");
  const enabled = computed(() => Boolean(workspaceStore.initialized && workspaceStore.activeWorkspaceSlug && projectId.value));
  const message = ref("");

  const projectQueryKey = computed(() => [...PROJECT_QUERY_KEY_PREFIX, workspaceScope.value, projectId.value || "none"]);

  const query = useQuery({
    queryKey: projectQueryKey,
    queryFn: () => api.projects.get(projectId.value),
    enabled
  });

  const project = computed(() => {
    const source = query.data.value?.project;
    return source && typeof source === "object" ? source : null;
  });

  watch(
    () => project.value,
    (nextProject) => {
      if (!nextProject) {
        return;
      }

      form.name = String(nextProject.name || "");
      form.status = String(nextProject.status || "draft");
      form.owner = String(nextProject.owner || "");
      form.notes = String(nextProject.notes || "");
    },
    { immediate: true }
  );

  const mutation = useMutation({
    mutationFn: (payload) => api.projects.update(projectId.value, payload)
  });

  const loading = computed(() => Boolean(query.isPending.value || query.isFetching.value));
  const saving = computed(() => mutation.isPending.value);

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

  async function save() {
    error.value = "";
    message.value = "";

    try {
      const response = await mutation.mutateAsync({
        name: form.name,
        status: form.status,
        owner: form.owner,
        notes: form.notes
      });

      queryClient.setQueryData(projectQueryKey.value, response);
      await queryClient.invalidateQueries({
        queryKey: [...PROJECTS_QUERY_KEY_PREFIX, workspaceScope.value]
      });

      message.value = "Project updated.";
    } catch (nextError) {
      if (await handleUnauthorizedError(nextError)) {
        return;
      }

      error.value = mapProjectsError(nextError, "Unable to update project.").message;
    }
  }

  return {
    meta: {
      projectStatusOptions
    },
    state: reactive({
      projectId,
      project,
      form,
      loading,
      saving,
      error,
      message
    }),
    actions: {
      refresh: () => query.refetch(),
      save,
      goBack: () => {
        if (!projectId.value) {
          return navigate({
            to: workspacePath("/projects")
          });
        }

        return navigate({
          to: workspacePath(`/projects/${encodeURIComponent(projectId.value)}`)
        });
      }
    }
  };
}
