import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useAuthGuard } from "../../composables/useAuthGuard.js";
import { api } from "../../services/api/index.js";
import { useConsoleStore } from "../../stores/consoleStore.js";

const CONSOLE_SETTINGS_QUERY_KEY = ["console-settings"];

export function useConsoleHomeView() {
  const queryClient = useQueryClient();
  const consoleStore = useConsoleStore();
  const { handleUnauthorizedError } = useAuthGuard();

  const form = reactive({
    assistantSystemPromptWorkspace: ""
  });
  const error = ref("");
  const message = ref("");
  const messageType = ref("success");

  const canManageSettings = computed(() => consoleStore.can("console.members.manage"));

  const settingsQuery = useQuery({
    queryKey: CONSOLE_SETTINGS_QUERY_KEY,
    queryFn: () => api.console.getSettings()
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (payload) => api.console.updateSettings(payload)
  });

  const isLoading = computed(() => settingsQuery.isPending.value);
  const isSaving = computed(() => updateSettingsMutation.isPending.value);

  function applySettingsData(data) {
    form.assistantSystemPromptWorkspace = String(data?.settings?.assistantSystemPromptWorkspace || "");
  }

  watch(
    () => settingsQuery.data.value,
    (data) => {
      if (!data) {
        return;
      }
      error.value = "";
      applySettingsData(data);
    },
    { immediate: true }
  );

  watch(
    () => settingsQuery.error.value,
    async (queryError) => {
      if (!queryError) {
        return;
      }

      if (await handleUnauthorizedError(queryError)) {
        return;
      }

      error.value = String(queryError?.message || "Unable to load console settings.");
    }
  );

  async function submitSettings() {
    if (!canManageSettings.value) {
      return;
    }

    message.value = "";

    try {
      const payload = {
        assistantSystemPromptWorkspace: form.assistantSystemPromptWorkspace
      };
      const data = await updateSettingsMutation.mutateAsync(payload);
      queryClient.setQueryData(CONSOLE_SETTINGS_QUERY_KEY, data);
      applySettingsData(data);
      messageType.value = "success";
      message.value = "Console settings updated.";
    } catch (mutationError) {
      if (await handleUnauthorizedError(mutationError)) {
        return;
      }

      messageType.value = "error";
      message.value = String(mutationError?.message || "Unable to update console settings.");
    }
  }

  return {
    form,
    feedback: reactive({
      error,
      message,
      messageType
    }),
    status: reactive({
      isLoading,
      isSaving
    }),
    permissions: reactive({
      canManageSettings
    }),
    actions: {
      submitSettings
    }
  };
}
