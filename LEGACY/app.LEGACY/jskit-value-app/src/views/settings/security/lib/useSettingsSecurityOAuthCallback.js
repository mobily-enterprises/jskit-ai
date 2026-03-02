import { api } from "../../../../platform/http/api/index.js";
import {
  clearPendingOAuthContext,
  readOAuthCallbackStateFromLocation,
  readPendingOAuthContext,
  stripOAuthCallbackParamsFromLocation
} from "../../../../modules/auth/oauthCallback.js";
import { SETTINGS_QUERY_KEY, SETTINGS_SECTION_QUERY_KEY } from "../../lib/useSettingsPageConfig.js";

export function useSettingsSecurityOAuthCallback({
  authStore,
  queryClient,
  providerMessage,
  providerMessageType,
  providerLinkStartInFlight,
  providerLabel,
  buildSettingsPathWithTab,
  handleAuthError,
  toErrorMessage
}) {
  async function handleOAuthCallbackIfPresent() {
    const providers = Array.isArray(authStore.oauthProviders) ? authStore.oauthProviders : [];
    const defaultProvider = authStore.oauthDefaultProvider;
    const pendingOAuthContext = readPendingOAuthContext({
      providers,
      defaultProvider
    });
    const callbackState = readOAuthCallbackStateFromLocation({
      providers,
      pendingContext: pendingOAuthContext,
      defaultProvider,
      defaultIntent: "link",
      defaultReturnTo: buildSettingsPathWithTab("profile")
    });

    if (!callbackState) {
      return;
    }

    providerMessage.value = "";
    providerLinkStartInFlight.value = true;

    try {
      await api.auth.oauthComplete(callbackState.payload);
      const session = await authStore.refreshSession();
      if (!session?.authenticated) {
        throw new Error("Provider link succeeded but the active session is unavailable. Please retry.");
      }

      stripOAuthCallbackParamsFromLocation({
        preserveSearchKeys: [SETTINGS_SECTION_QUERY_KEY, "returnTo"]
      });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });

      providerMessageType.value = "success";
      providerMessage.value =
        callbackState.intent === "link" ? `${providerLabel(callbackState.provider)} linked.` : "Sign-in completed.";
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      providerMessageType.value = "error";
      providerMessage.value = toErrorMessage(error, "Unable to complete provider link.");
      stripOAuthCallbackParamsFromLocation({
        preserveSearchKeys: [SETTINGS_SECTION_QUERY_KEY, "returnTo"]
      });
    } finally {
      clearPendingOAuthContext();
      providerLinkStartInFlight.value = false;
    }
  }

  return {
    handleOAuthCallbackIfPresent
  };
}
