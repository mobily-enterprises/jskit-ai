import { reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../../../services/api/index.js";
import { SETTINGS_CHAT_DEFAULTS } from "@jskit-ai/workspace-console-core/settingsModel";
import { SETTINGS_QUERY_KEY } from "../lib/useSettingsPageConfig.js";
import { useSettingsContext } from "../lib/useSettingsContext.js";
import { useSettingsChatLogic } from "./lib/useSettingsChatLogic.js";

export function useSettingsChatForm(options) {
  if (!options) {
    return useSettingsContext().sections.chat;
  }

  const { queryClient, clearFieldErrors, toErrorMessage, handleAuthError, applySettingsData } = options;

  const chatForm = reactive({
    publicChatId: SETTINGS_CHAT_DEFAULTS.publicChatId,
    allowWorkspaceDms: SETTINGS_CHAT_DEFAULTS.allowWorkspaceDms,
    allowGlobalDms: SETTINGS_CHAT_DEFAULTS.allowGlobalDms,
    requireSharedWorkspaceForGlobalDm: SETTINGS_CHAT_DEFAULTS.requireSharedWorkspaceForGlobalDm,
    discoverableByPublicChatId: SETTINGS_CHAT_DEFAULTS.discoverableByPublicChatId
  });

  const chatFieldErrors = reactive({
    publicChatId: "",
    allowWorkspaceDms: "",
    allowGlobalDms: "",
    requireSharedWorkspaceForGlobalDm: "",
    discoverableByPublicChatId: "",
    chat: ""
  });

  const chatMessage = ref("");
  const chatMessageType = ref("success");

  const chatMutation = useMutation({
    mutationFn: (payload) => api.settings.updateChat(payload)
  });

  const { submitChat } = useSettingsChatLogic({
    chatForm,
    chatFieldErrors,
    chatMessage,
    chatMessageType,
    chatMutation,
    settingsQueryKey: SETTINGS_QUERY_KEY,
    queryClient,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    applySettingsData
  });

  function hydrate(data) {
    if (!data || typeof data !== "object") {
      return;
    }

    chatForm.publicChatId = String(data.chat?.publicChatId || "");
    chatForm.allowWorkspaceDms = Boolean(data.chat?.allowWorkspaceDms);
    chatForm.allowGlobalDms = Boolean(data.chat?.allowGlobalDms);
    chatForm.requireSharedWorkspaceForGlobalDm = Boolean(data.chat?.requireSharedWorkspaceForGlobalDm);
    chatForm.discoverableByPublicChatId = Boolean(data.chat?.discoverableByPublicChatId);
  }

  return {
    state: reactive({
      chatForm,
      chatFieldErrors,
      chatMessage,
      chatMessageType,
      chatMutation
    }),
    actions: {
      submitChat
    },
    hydrate
  };
}
