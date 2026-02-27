import { buildVersionedApiPath } from "@jskit-ai/surface-routing/apiPaths";

function createApi({ request }) {
  return {
    get() {
      return request("/api/v1/settings");
    },
    updateProfile(payload) {
      return request("/api/v1/settings/profile", { method: "PATCH", body: payload });
    },
    uploadAvatar(payload) {
      return request("/api/v1/settings/profile/avatar", { method: "POST", body: payload });
    },
    deleteAvatar() {
      return request("/api/v1/settings/profile/avatar", { method: "DELETE" });
    },
    updatePreferences(payload) {
      return request("/api/v1/settings/preferences", { method: "PATCH", body: payload });
    },
    updateNotifications(payload) {
      return request("/api/v1/settings/notifications", { method: "PATCH", body: payload });
    },
    updateChat(payload) {
      return request("/api/v1/settings/chat", { method: "PATCH", body: payload });
    },
    changePassword(payload) {
      return request("/api/v1/settings/security/change-password", { method: "POST", body: payload });
    },
    setPasswordMethodEnabled(payload) {
      return request("/api/v1/settings/security/methods/password", { method: "PATCH", body: payload });
    },
    oauthLinkStartUrl(provider, options = {}) {
      const encodedProvider = encodeURIComponent(
        String(provider || "")
          .trim()
          .toLowerCase()
      );
      const oauthLinkStartPath = buildVersionedApiPath(`/settings/security/oauth/${encodedProvider}/start`);
      const returnTo = String(options.returnTo || "").trim();
      if (!returnTo) {
        return oauthLinkStartPath;
      }

      const params = new URLSearchParams({
        returnTo
      });
      return `${oauthLinkStartPath}?${params.toString()}`;
    },
    unlinkOAuthProvider(provider) {
      const encodedProvider = encodeURIComponent(
        String(provider || "")
          .trim()
          .toLowerCase()
      );
      return request(`/api/v1/settings/security/oauth/${encodedProvider}`, { method: "DELETE" });
    },
    logoutOtherSessions() {
      return request("/api/v1/settings/security/logout-others", { method: "POST" });
    }
  };
}

export { createApi };
