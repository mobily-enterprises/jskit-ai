export function useSettingsProfileSection(settingsView) {
  const { state, actions } = settingsView;

  return {
    meta: {},
    state: {
      preferencesForm: state.preferencesForm,
      profileAvatar: state.profileAvatar,
      profileInitials: state.profileInitials,
      selectedAvatarFileName: state.selectedAvatarFileName,
      avatarMessage: state.avatarMessage,
      avatarMessageType: state.avatarMessageType,
      profileForm: state.profileForm,
      profileFieldErrors: state.profileFieldErrors,
      profileMessage: state.profileMessage,
      profileMessageType: state.profileMessageType,
      avatarDeleteMutation: state.avatarDeleteMutation,
      profileMutation: state.profileMutation
    },
    actions: {
      submitProfile: actions.submitProfile,
      openAvatarEditor: actions.openAvatarEditor,
      submitAvatarDelete: actions.submitAvatarDelete
    }
  };
}
