import { computed, reactive, ref } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { api } from "../../platform/http/api/index.js";
import { useAuthGuard } from "../../modules/auth/useAuthGuard.js";
import { useWorkspaceStore } from "../../app/state/workspaceStore.js";
import { mapProjectsError } from "../../modules/projects/errors.js";
import { createDefaultProjectForm, projectStatusOptions } from "../../modules/projects/formModel.js";
import { projectsScopeQueryKey } from "../../modules/projects/queryKeys.js";
import { buildProjectsRouteSuffix } from "./routePaths.js";

export function useProjectsAdd() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workspaceStore = useWorkspaceStore();
  const { handleUnauthorizedError } = useAuthGuard();

  const form = reactive(createDefaultProjectForm());
  const error = ref("");
  const message = ref("");

  const mutation = useMutation({
    mutationFn: (payload) => api.projects.create(payload)
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
        queryKey: projectsScopeQueryKey(workspaceScope.value)
      });

      if (nextProjectId) {
        await navigate({
          to: workspacePath(buildProjectsRouteSuffix(`/${encodeURIComponent(nextProjectId)}`))
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
          to: workspacePath(buildProjectsRouteSuffix())
        })
    }
  };
}
