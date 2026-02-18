import { computed, reactive, ref } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { api } from "../../services/api/index.js";
import { useAuthGuard } from "../../composables/useAuthGuard";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { mapProjectsError } from "../../features/projects/errors";
import { createDefaultProjectForm, projectStatusOptions } from "../../features/projects/formModel";
import { PROJECTS_QUERY_KEY_PREFIX } from "./queryKeys";

export function useProjectsAdd() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceStore = useWorkspaceStore();
  const { handleUnauthorizedError } = useAuthGuard();

  const form = reactive(createDefaultProjectForm());
  const error = ref("");
  const message = ref("");

  const mutation = useMutation({
    mutationFn: (payload) => api.createWorkspaceProject(payload)
  });

  const saving = computed(() => mutation.isPending.value);
  const workspaceScope = computed(() => workspaceStore.activeWorkspaceSlug || "none");

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

      const nextProjectId = String(response?.project?.id || "").trim();
      await queryClient.invalidateQueries({
        queryKey: [...PROJECTS_QUERY_KEY_PREFIX, workspaceScope.value]
      });

      if (nextProjectId) {
        await navigate({
          to: workspacePath(`/projects/${encodeURIComponent(nextProjectId)}`)
        });
        return;
      }

      message.value = "Project created.";
    } catch (nextError) {
      if (await handleUnauthorizedError(nextError)) {
        return;
      }

      error.value = mapProjectsError(nextError, "Unable to create project.").message;
    }
  }

  function reset() {
    Object.assign(form, createDefaultProjectForm());
    error.value = "";
    message.value = "";
  }

  return {
    meta: {
      projectStatusOptions
    },
    state: reactive({
      form,
      error,
      message,
      saving
    }),
    actions: {
      save,
      reset,
      goBack: () =>
        navigate({
          to: workspacePath("/projects")
        })
    }
  };
}
