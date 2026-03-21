import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import ImageEditor from "@uppy/image-editor";
import Compressor from "@uppy/compressor";
import XHRUpload from "@uppy/xhr-upload";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import "@uppy/image-editor/css/style.min.css";
import { resolveFieldErrors } from "@jskit-ai/http-runtime/client";
import { usersWebHttpClient } from "../lib/httpClient.js";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_UPLOAD_BYTES
} from "./accountSettingsRuntimeConstants.js";

function parseUploadResponse(xhr) {
  if (!xhr.responseText) {
    return {};
  }

  try {
    return JSON.parse(xhr.responseText);
  } catch {
    return {};
  }
}

function stopImageEditor(uppy) {
  const imageEditor = uppy.getPlugin("ImageEditor");
  if (imageEditor && typeof imageEditor.stop === "function") {
    imageEditor.stop();
  }
}

function createAccountSettingsAvatarUploadRuntime({
  queryClient,
  sessionQueryKey,
  accountSettingsQueryKey,
  selectedAvatarFileName,
  applySettingsData,
  reportAccountFeedback
} = {}) {
  let avatarUppy = null;

  async function resolveCsrfToken() {
    const sessionPayload = await queryClient.fetchQuery({
      queryKey: sessionQueryKey,
      queryFn: () =>
        usersWebHttpClient.request("/api/session", {
          method: "GET"
        }),
      staleTime: 60_000
    });

    const csrfToken = String(sessionPayload?.csrfToken || "");
    if (!csrfToken) {
      throw new Error("Unable to prepare secure avatar upload request.");
    }

    return csrfToken;
  }

  function setup() {
    if (typeof window === "undefined") {
      return;
    }

    if (avatarUppy) {
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
        const csrfToken = await resolveCsrfToken();
        xhr.setRequestHeader("csrf-token", csrfToken);
      },
      getResponseData: parseUploadResponse
    });

    uppy.on("file-added", (file) => {
      selectedAvatarFileName.value = String(file?.name || "");
    });

    uppy.on("file-removed", () => {
      selectedAvatarFileName.value = "";
    });

    uppy.on("file-editor:complete", (file) => {
      selectedAvatarFileName.value = String(file?.name || selectedAvatarFileName.value || "");
      stopImageEditor(uppy);
    });

    uppy.on("file-editor:cancel", () => {
      stopImageEditor(uppy);
    });

    uppy.on("dashboard:modal-closed", () => {
      stopImageEditor(uppy);
    });

    uppy.on("upload-success", (_file, response) => {
      const data = response?.body;
      if (!data || typeof data !== "object") {
        reportAccountFeedback({
          message: "Avatar uploaded, but the response payload was invalid.",
          severity: "error",
          channel: "banner",
          dedupeKey: "users-web.account-settings-runtime:avatar-upload-invalid-response"
        });
        return;
      }

      applySettingsData(data);
      queryClient.setQueryData(accountSettingsQueryKey, data);

      const dashboard = uppy.getPlugin("Dashboard");
      if (dashboard && typeof dashboard.closeModal === "function") {
        dashboard.closeModal();
      }

      reportAccountFeedback({
        message: "Avatar uploaded.",
        severity: "success",
        channel: "snackbar",
        dedupeKey: "users-web.account-settings-runtime:avatar-uploaded"
      });
      selectedAvatarFileName.value = "";
    });

    uppy.on("upload-error", (_file, error, response) => {
      const body = response?.body && typeof response.body === "object" ? response.body : {};
      const fieldErrors = resolveFieldErrors(body);

      reportAccountFeedback({
        message: String(fieldErrors.avatar || body?.error || error?.message || "Unable to upload avatar."),
        severity: "error",
        channel: "banner",
        dedupeKey: "users-web.account-settings-runtime:avatar-upload-error"
      });
    });

    uppy.on("restriction-failed", (_file, error) => {
      reportAccountFeedback({
        message: String(error?.message || "Selected avatar file does not meet upload restrictions."),
        severity: "error",
        channel: "banner",
        dedupeKey: "users-web.account-settings-runtime:avatar-upload-restriction"
      });
    });

    uppy.on("complete", (result) => {
      const successfulCount = Array.isArray(result?.successful) ? result.successful.length : 0;
      if (successfulCount <= 0) {
        return;
      }

      try {
        uppy.clear();
      } catch {
        // Upload succeeded; ignore clear timing issues.
      }
    });

    avatarUppy = uppy;
  }

  function openEditor() {
    setup();

    const uppy = avatarUppy;
    if (!uppy) {
      reportAccountFeedback({
        message: "Avatar editor is unavailable in this environment.",
        severity: "error",
        channel: "banner",
        dedupeKey: "users-web.account-settings-runtime:avatar-editor-unavailable"
      });
      return;
    }

    const dashboard = uppy.getPlugin("Dashboard");
    if (dashboard && typeof dashboard.openModal === "function") {
      dashboard.openModal();
    }
  }

  function destroy() {
    if (!avatarUppy) {
      return;
    }

    avatarUppy.destroy();
    avatarUppy = null;
  }

  return Object.freeze({
    destroy,
    openEditor,
    setup
  });
}

export { createAccountSettingsAvatarUploadRuntime };
