import { computed, markRaw } from "vue";
import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import ImageEditor from "@uppy/image-editor";
import Compressor from "@uppy/compressor";
import XHRUpload from "@uppy/xhr-upload";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "@uppy/image-editor/css/style.min.css";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_SIZE,
  AVATAR_MAX_UPLOAD_BYTES
} from "../../../../../shared/avatar/index.js";
import { api } from "../../../../services/api/index.js";

export function useSettingsProfileLogic({
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
  settingsQueryKey,
  queryClient,
  authStore,
  clearFieldErrors,
  toErrorMessage,
  handleAuthError,
  applySettingsData,
  skipUploaderSetup = import.meta.env.MODE === "test"
}) {
  const profileInitials = computed(() => {
    const source = String(profileForm.displayName || authStore.username || "U").trim();
    return source.slice(0, 2).toUpperCase();
  });

  function applyAvatarData(avatar) {
    const nextAvatar = avatar && typeof avatar === "object" ? avatar : {};

    profileAvatar.uploadedUrl = nextAvatar.uploadedUrl ? String(nextAvatar.uploadedUrl) : null;
    profileAvatar.gravatarUrl = String(nextAvatar.gravatarUrl || "");
    profileAvatar.effectiveUrl = String(nextAvatar.effectiveUrl || profileAvatar.gravatarUrl || "");
    profileAvatar.hasUploadedAvatar = Boolean(nextAvatar.hasUploadedAvatar);
    profileAvatar.size = Number(nextAvatar.size || preferencesForm.avatarSize || AVATAR_DEFAULT_SIZE);
    profileAvatar.version = nextAvatar.version == null ? null : String(nextAvatar.version);
  }

  function setupAvatarUploader() {
    if (typeof window === "undefined") {
      return;
    }

    if (skipUploaderSetup) {
      return;
    }

    if (avatarUppy.value) {
      return;
    }

    const uppy = new Uppy({
      autoProceed: false,
      restrictions: {
        maxNumberOfFiles: 1,
        allowedFileTypes: [...AVATAR_ALLOWED_MIME_TYPES],
        maxFileSize: AVATAR_MAX_UPLOAD_BYTES
      }
    });

    uppy.use(Dashboard, {
      inline: false,
      closeAfterFinish: false,
      showProgressDetails: true,
      proudlyDisplayPoweredByUppy: false,
      hideUploadButton: false,
      doneButtonHandler: () => {
        const dashboard = uppy.getPlugin("Dashboard");
        if (dashboard && typeof dashboard.closeModal === "function") {
          dashboard.closeModal();
        }
      },
      note: `Accepted: ${AVATAR_ALLOWED_MIME_TYPES.join(", ")}, max ${Math.floor(AVATAR_MAX_UPLOAD_BYTES / (1024 * 1024))}MB`
    });
    uppy.use(ImageEditor, {
      quality: 0.9
    });
    uppy.use(Compressor, {
      quality: 0.84,
      limit: 1
    });
    uppy.use(XHRUpload, {
      endpoint: "/api/settings/profile/avatar",
      method: "POST",
      formData: true,
      fieldName: "avatar",
      withCredentials: true,
      onBeforeRequest: async (xhr) => {
        const session = await api.auth.session();
        const csrfToken = String(session?.csrfToken || "");
        if (!csrfToken) {
          throw new Error("Unable to prepare secure avatar upload request.");
        }
        xhr.setRequestHeader("csrf-token", csrfToken);
      },
      getResponseData: (xhr) => {
        if (!xhr.responseText) {
          return {};
        }

        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return {};
        }
      }
    });

    uppy.on("file-added", (file) => {
      selectedAvatarFileName.value = String(file?.name || "");
    });
    uppy.on("file-removed", () => {
      selectedAvatarFileName.value = "";
    });
    uppy.on("file-editor:complete", (file) => {
      selectedAvatarFileName.value = String(file?.name || selectedAvatarFileName.value || "");
      const imageEditor = uppy.getPlugin("ImageEditor");
      if (imageEditor && typeof imageEditor.stop === "function") {
        imageEditor.stop();
      }
    });
    uppy.on("file-editor:cancel", () => {
      const imageEditor = uppy.getPlugin("ImageEditor");
      if (imageEditor && typeof imageEditor.stop === "function") {
        imageEditor.stop();
      }
    });
    uppy.on("dashboard:modal-closed", () => {
      const imageEditor = uppy.getPlugin("ImageEditor");
      if (imageEditor && typeof imageEditor.stop === "function") {
        imageEditor.stop();
      }
    });
    uppy.on("upload-success", (_file, response) => {
      const data = response?.body;
      if (!data || typeof data !== "object") {
        avatarMessageType.value = "error";
        avatarMessage.value = "Avatar uploaded, but the response payload was invalid.";
        return;
      }

      queryClient.setQueryData(settingsQueryKey, data);
      applySettingsData(data);

      const dashboard = uppy.getPlugin("Dashboard");
      if (dashboard && typeof dashboard.closeModal === "function") {
        dashboard.closeModal();
      }

      avatarMessageType.value = "success";
      avatarMessage.value = "Avatar uploaded.";
      selectedAvatarFileName.value = "";
    });
    uppy.on("upload-error", (_file, error, response) => {
      const status = Number(response?.status || 0);
      const body = response?.body && typeof response.body === "object" ? response.body : {};
      const fieldErrors =
        body?.fieldErrors && typeof body.fieldErrors === "object"
          ? body.fieldErrors
          : body?.details?.fieldErrors && typeof body.details.fieldErrors === "object"
            ? body.details.fieldErrors
            : {};

      if (status === 401) {
        void handleAuthError({
          status,
          message: String(body?.error || error?.message || "Authentication required.")
        });
        return;
      }

      avatarMessageType.value = "error";
      avatarMessage.value = String(fieldErrors.avatar || body?.error || error?.message || "Unable to upload avatar.");
    });
    uppy.on("restriction-failed", (_file, error) => {
      avatarMessageType.value = "error";
      avatarMessage.value = String(error?.message || "Selected avatar file does not meet upload restrictions.");
    });
    uppy.on("complete", (result) => {
      const successfulCount = Array.isArray(result?.successful) ? result.successful.length : 0;
      if (successfulCount <= 0) {
        return;
      }

      try {
        uppy.clear();
      } catch {
        // Ignore non-critical clear timing issues; upload already succeeded.
      }
    });

    avatarUppy.value = markRaw(uppy);
  }

  async function submitProfile() {
    clearFieldErrors(profileFieldErrors);
    profileMessage.value = "";

    try {
      const data = await profileMutation.mutateAsync({
        displayName: profileForm.displayName
      });

      queryClient.setQueryData(settingsQueryKey, data);
      applySettingsData(data);
      authStore.setUsername(data.profile?.displayName || null);
      profileMessageType.value = "success";
      profileMessage.value = "Profile updated.";
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      if (error?.fieldErrors?.displayName) {
        profileFieldErrors.displayName = String(error.fieldErrors.displayName);
      }

      profileMessageType.value = "error";
      profileMessage.value = toErrorMessage(error, "Unable to update profile.");
    }
  }

  async function openAvatarEditor() {
    avatarMessage.value = "";
    setupAvatarUploader();
    const uppy = avatarUppy.value;
    if (!uppy) {
      avatarMessageType.value = "error";
      avatarMessage.value = "Avatar editor is unavailable in this environment.";
      return;
    }

    const dashboard = uppy.getPlugin("Dashboard");
    if (dashboard && typeof dashboard.openModal === "function") {
      dashboard.openModal();
    }
  }

  async function submitAvatarDelete() {
    avatarMessage.value = "";

    try {
      const data = await avatarDeleteMutation.mutateAsync();
      queryClient.setQueryData(settingsQueryKey, data);
      applySettingsData(data);
      avatarMessageType.value = "success";
      avatarMessage.value = "Avatar removed.";
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      avatarMessageType.value = "error";
      avatarMessage.value = toErrorMessage(error, "Unable to remove avatar.");
    }
  }

  return {
    profileInitials,
    applyAvatarData,
    setupAvatarUploader,
    submitProfile,
    openAvatarEditor,
    submitAvatarDelete
  };
}
