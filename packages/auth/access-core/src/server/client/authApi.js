import { buildVersionedApiPath } from "@jskit-ai/surface-routing/apiPaths";

function createApi({ request }) {
  return {
    session() {
      return request("/api/v1/session");
    },
    register(payload) {
      return request("/api/v1/register", { method: "POST", body: payload });
    },
    login(payload) {
      return request("/api/v1/login", { method: "POST", body: payload });
    },
    requestOtp(payload) {
      return request("/api/v1/login/otp/request", { method: "POST", body: payload });
    },
    verifyOtp(payload) {
      return request("/api/v1/login/otp/verify", { method: "POST", body: payload });
    },
    oauthStartUrl(provider, options = {}) {
      const encodedProvider = encodeURIComponent(
        String(provider || "")
          .trim()
          .toLowerCase()
      );
      const oauthStartPath = buildVersionedApiPath(`/oauth/${encodedProvider}/start`);
      const returnTo = String(options.returnTo || "").trim();
      if (!returnTo) {
        return oauthStartPath;
      }

      const params = new URLSearchParams({
        returnTo
      });
      return `${oauthStartPath}?${params.toString()}`;
    },
    oauthComplete(payload) {
      return request("/api/v1/oauth/complete", { method: "POST", body: payload });
    },
    requestPasswordReset(payload) {
      return request("/api/v1/password/forgot", { method: "POST", body: payload });
    },
    completePasswordRecovery(payload) {
      return request("/api/v1/password/recovery", { method: "POST", body: payload });
    },
    resetPassword(payload) {
      return request("/api/v1/password/reset", { method: "POST", body: payload });
    },
    logout() {
      return request("/api/v1/logout", { method: "POST" });
    }
  };
}

export { createApi };
