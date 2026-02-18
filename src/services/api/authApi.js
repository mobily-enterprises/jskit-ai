function createAuthApi({ request }) {
  return {
    session() {
      return request("/api/session");
    },
    register(payload) {
      return request("/api/register", { method: "POST", body: payload });
    },
    login(payload) {
      return request("/api/login", { method: "POST", body: payload });
    },
    requestOtpLogin(payload) {
      return request("/api/login/otp/request", { method: "POST", body: payload });
    },
    verifyOtpLogin(payload) {
      return request("/api/login/otp/verify", { method: "POST", body: payload });
    },
    oauthStartUrl(provider, options = {}) {
      const encodedProvider = encodeURIComponent(
        String(provider || "")
          .trim()
          .toLowerCase()
      );
      const returnTo = String(options.returnTo || "").trim();
      if (!returnTo) {
        return `/api/oauth/${encodedProvider}/start`;
      }

      const params = new URLSearchParams({
        returnTo
      });
      return `/api/oauth/${encodedProvider}/start?${params.toString()}`;
    },
    oauthComplete(payload) {
      return request("/api/oauth/complete", { method: "POST", body: payload });
    },
    requestPasswordReset(payload) {
      return request("/api/password/forgot", { method: "POST", body: payload });
    },
    completePasswordRecovery(payload) {
      return request("/api/password/recovery", { method: "POST", body: payload });
    },
    resetPassword(payload) {
      return request("/api/password/reset", { method: "POST", body: payload });
    },
    logout() {
      return request("/api/logout", { method: "POST" });
    }
  };
}

export { createAuthApi };
