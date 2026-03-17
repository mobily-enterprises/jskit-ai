import { buildVersionedApiPath } from "@jskit-ai/kernel/shared/surface/apiPaths";

function createApi({ request }) {
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
    requestOtp(payload) {
      return request("/api/login/otp/request", { method: "POST", body: payload });
    },
    verifyOtp(payload) {
      return request("/api/login/otp/verify", { method: "POST", body: payload });
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

export { createApi };
