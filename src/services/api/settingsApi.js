function createApi({ request }) {
  return {
    get() {
      return request("/api/settings");
    },
    updateProfile(payload) {
      return request("/api/settings/profile", { method: "PATCH", body: payload });
    },
    uploadAvatar(payload) {
      return request("/api/settings/profile/avatar", { method: "POST", body: payload });
    },
    deleteAvatar() {
      return request("/api/settings/profile/avatar", { method: "DELETE" });
    },
    updatePreferences(payload) {
      return request("/api/settings/preferences", { method: "PATCH", body: payload });
    },
    updateNotifications(payload) {
      return request("/api/settings/notifications", { method: "PATCH", body: payload });
    },
    changePassword(payload) {
      return request("/api/settings/security/change-password", { method: "POST", body: payload });
    },
    setPasswordMethodEnabled(payload) {
      return request("/api/settings/security/methods/password", { method: "PATCH", body: payload });
    },
    oauthLinkStartUrl(provider, options = {}) {
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
    unlinkOAuthProvider(provider) {
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

export { createApi };
