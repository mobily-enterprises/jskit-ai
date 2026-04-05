import "@jskit-ai/uploads-image-web/client/styles";
import { createManagedImageAssetRuntime } from "@jskit-ai/uploads-image-web/client/composables/createManagedImageAssetRuntime";
import { resolveFieldErrors } from "@jskit-ai/http-runtime/client";
import { usersWebHttpClient } from "../lib/httpClient.js";

function createAccountSettingsAvatarUploadRuntime({
  queryClient,
  sessionQueryKey,
  accountSettingsQueryKey,
  selectedAvatarFileName,
  applySettingsData,
  reportAccountFeedback
} = {}) {
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

  return createManagedImageAssetRuntime({
    uploadEndpoint: "/api/settings/profile/avatar",
    fieldName: "avatar",
    selectedFileName: selectedAvatarFileName,
    resolveRequestHeaders: async () => ({
      "csrf-token": await resolveCsrfToken()
    }),
    onUploadSuccess: ({ data }) => {
      applySettingsData(data);
      queryClient.setQueryData(accountSettingsQueryKey, data);
    },
    reportFeedback: reportAccountFeedback,
    resolveUploadErrorMessage: ({ error, response, defaultMessage }) => {
      const body = response?.body && typeof response.body === "object" ? response.body : {};
      const fieldErrors = resolveFieldErrors(body);
      return String(fieldErrors.avatar || body?.error || error?.message || defaultMessage);
    },
    messages: {
      uploadSuccess: "Avatar uploaded.",
      uploadInvalidResponse: "Avatar uploaded, but the response payload was invalid.",
      uploadError: "Unable to upload avatar.",
      uploadRestriction: "Selected avatar file does not meet upload restrictions.",
      editorUnavailable: "Avatar editor is unavailable in this environment.",
      changeError: "Avatar uploaded, but the settings view could not refresh."
    },
    source: "users-web.account-settings-runtime:avatar"
  });
}

export { createAccountSettingsAvatarUploadRuntime };
