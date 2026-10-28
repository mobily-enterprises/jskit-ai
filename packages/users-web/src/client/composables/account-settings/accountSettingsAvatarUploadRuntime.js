import "@jskit-ai/uploads-image-web/client/styles";
import { createManagedImageAssetRuntime } from "@jskit-ai/uploads-image-web/client/composables/createManagedImageAssetRuntime";
import { resolveFieldErrors } from "@jskit-ai/http-runtime/client";
import { httpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useJskitText } from "../../i18n.js";

function createAccountSettingsAvatarUploadRuntime({
  queryClient,
  sessionQueryKey,
  accountSettingsQueryKey,
  selectedAvatarFileName,
  applySettingsData,
  reportAccountFeedback
} = {}) {
  const { t, fieldErrorMessages, serverMessage } = useJskitText();

  async function resolveCsrfToken() {
    const sessionPayload = await queryClient.fetchQuery({
      queryKey: sessionQueryKey,
      queryFn: () =>
        httpWebClient.request("/api/session", {
          method: "GET"
        }),
      staleTime: 60_000
    });

    const csrfToken = String(sessionPayload?.csrfToken || "");
    if (!csrfToken) {
      throw new Error(t("jskit.users.accountSettings.avatar.secureRequestFailed"));
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
      const fieldError = fieldErrorMessages({ ...body, fieldErrors: resolveFieldErrors(body) }).avatar;
      const bodyError = body.error ? serverMessage({ ...body, message: body.error }) : "";
      return String(fieldError || bodyError || error?.message || defaultMessage);
    },
    // Message keys, translated when shown.
    messages: {
      uploadSuccess: "jskit.users.accountSettings.avatar.uploaded",
      uploadInvalidResponse: "jskit.users.accountSettings.avatar.uploadInvalidResponse",
      uploadError: "jskit.users.accountSettings.avatar.uploadFailed",
      uploadRestriction: "jskit.users.accountSettings.avatar.uploadRestriction",
      editorUnavailable: "jskit.users.accountSettings.avatar.editorUnavailable",
      changeError: "jskit.users.accountSettings.avatar.refreshFailed"
    },
    source: "users-web.account-settings-runtime:avatar"
  });
}

export { createAccountSettingsAvatarUploadRuntime };
