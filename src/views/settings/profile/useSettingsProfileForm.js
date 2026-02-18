import { reactive, ref, shallowRef, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../../../services/api/index.js";
import { AVATAR_DEFAULT_SIZE } from "../../../../shared/avatar/index.js";
import { SETTINGS_QUERY_KEY } from "../lib/useSettingsPageConfig.js";
import { useSettingsContext } from "../lib/useSettingsContext.js";
import { createDefaultAvatar } from "./lib/settingsProfileDefaults.js";
import { useSettingsProfileLogic } from "./lib/useSettingsProfileLogic.js";

export function useSettingsProfileForm(options) {
  if (!options) {
    return useSettingsContext().sections.profile;
  }

  const {
    preferencesForm,
    queryClient,
    authStore,
    workspaceStore,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    applySettingsData
  } = options;

  const profileForm = reactive({
    displayName: "",
    email: ""
  });

  const profileAvatar = reactive(createDefaultAvatar());
  const selectedAvatarFileName = ref("");
  const avatarUppy = shallowRef(null);

  const profileFieldErrors = reactive({
    displayName: ""
  });

  const profileMessage = ref("");
  const profileMessageType = ref("success");
  const avatarMessage = ref("");
  const avatarMessageType = ref("success");

  const profileMutation = useMutation({
    mutationFn: (payload) => api.settings.updateProfile(payload)
  });

  const avatarDeleteMutation = useMutation({
    mutationFn: () => api.settings.deleteAvatar()
  });

  const { profileInitials, applyAvatarData, setupAvatarUploader, submitProfile, openAvatarEditor, submitAvatarDelete } =
    useSettingsProfileLogic({
      profileForm,
      preferencesForm,
      profileAvatar,
      selectedAvatarFileName,
      avatarUppy,
      profileFieldErrors,
      profileMessage,
      profileMessageType,
      avatarMessage,
      avatarMessageType,
      profileMutation,
      avatarDeleteMutation,
      settingsQueryKey: SETTINGS_QUERY_KEY,
      queryClient,
      authStore,
      clearFieldErrors,
      toErrorMessage,
      handleAuthError,
      applySettingsData
    });

  watch(
    () => preferencesForm.avatarSize,
    (nextSize) => {
      profileAvatar.size = Number(nextSize || AVATAR_DEFAULT_SIZE);
    },
    { immediate: true }
  );

  function hydrate(data) {
    if (!data || typeof data !== "object") {
      return;
    }

    profileForm.displayName = String(data.profile?.displayName || "");
    profileForm.email = String(data.profile?.email || "");
    applyAvatarData(data.profile?.avatar);

    authStore.setUsername(profileForm.displayName || null);
    workspaceStore.applyProfile({
      displayName: profileForm.displayName,
      email: profileForm.email,
      avatar: { ...profileAvatar }
    });
  }

  function initialize() {
    setupAvatarUploader();
  }

  function dispose() {
    if (avatarUppy.value) {
      avatarUppy.value.destroy();
      avatarUppy.value = null;
    }
  }

  return {
    state: reactive({
      preferencesForm,
      profileAvatar,
      profileInitials,
      selectedAvatarFileName,
      avatarMessage,
      avatarMessageType,
      profileForm,
      profileFieldErrors,
      profileMessage,
      profileMessageType,
      avatarDeleteMutation,
      profileMutation
    }),
    actions: {
      submitProfile,
      openAvatarEditor,
      submitAvatarDelete
    },
    hydrate,
    initialize,
    dispose
  };
}
