function normalizePublicChatId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function useSettingsChatLogic({
  chatForm,
  chatFieldErrors,
  chatMessage,
  chatMessageType,
  chatMutation,
  settingsQueryKey,
  queryClient,
  clearFieldErrors,
  toErrorMessage,
  handleAuthError,
  applySettingsData
}) {
  async function submitChat() {
    clearFieldErrors(chatFieldErrors);
    chatMessage.value = "";

    try {
      const data = await chatMutation.mutateAsync({
        publicChatId: normalizePublicChatId(chatForm.publicChatId),
        allowWorkspaceDms: Boolean(chatForm.allowWorkspaceDms),
        allowGlobalDms: Boolean(chatForm.allowGlobalDms),
        requireSharedWorkspaceForGlobalDm: Boolean(chatForm.requireSharedWorkspaceForGlobalDm),
        discoverableByPublicChatId: Boolean(chatForm.discoverableByPublicChatId)
      });

      queryClient.setQueryData(settingsQueryKey, data);
      applySettingsData(data);
      chatMessageType.value = "success";
      chatMessage.value = "Chat settings updated.";
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      if (error?.fieldErrors && typeof error.fieldErrors === "object") {
        for (const key of Object.keys(chatFieldErrors)) {
          if (error.fieldErrors[key]) {
            chatFieldErrors[key] = String(error.fieldErrors[key]);
          }
        }
      }

      chatMessageType.value = "error";
      chatMessage.value = toErrorMessage(error, "Unable to update chat settings.");
    }
  }

  return {
    submitChat
  };
}
