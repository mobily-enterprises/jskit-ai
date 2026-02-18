function createSettingsApi({ request }) {
  return {
    settings() {
      return request("/api/settings");
    },
    updateProfileSettings(payload) {
      return request("/api/settings/profile", { method: "PATCH", body: payload });
    },
    uploadProfileAvatar(payload) {
      return request("/api/settings/profile/avatar", { method: "POST", body: payload });
    },
    deleteProfileAvatar() {
      return request("/api/settings/profile/avatar", { method: "DELETE" });
    },
    updatePreferencesSettings(payload) {
      return request("/api/settings/preferences", { method: "PATCH", body: payload });
    },
    updateNotificationSettings(payload) {
      return request("/api/settings/notifications", { method: "PATCH", body: payload });
    },
    changePassword(payload) {
      return request("/api/settings/security/change-password", { method: "POST", body: payload });
    },
    setPasswordMethodEnabled(payload) {
      return request("/api/settings/security/methods/password", { method: "PATCH", body: payload });
    },
    settingsOAuthLinkStartUrl(provider, options = {}) {
      const encodedProvider = encodeURIComponent(
        String(provider || "")
          .trim()
          .toLowerCase()
      );
      const returnTo = String(options.returnTo || "").trim();
      if (!returnTo) {
        return `/api/settings/security/oauth/${encodedProvider}/start`;
      }

      const params = new URLSearchParams({
        returnTo
      });
      return `/api/settings/security/oauth/${encodedProvider}/start?${params.toString()}`;
    },
    unlinkSettingsOAuthProvider(provider) {
      const encodedProvider = encodeURIComponent(
        String(provider || "")
          .trim()
          .toLowerCase()
      );
      return request(`/api/settings/security/oauth/${encodedProvider}`, { method: "DELETE" });
    },
    logoutOtherSessions() {
      return request("/api/settings/security/logout-others", { method: "POST" });
    }
  };
}

export { createSettingsApi };
