import { AUTH_ACTION_IDS } from "../constants/authActionIds.js";

class AuthWebService {
  constructor({ authService, getAuthService, devAuthBootstrapEnabled } = {}) {
    if (!authService && typeof getAuthService !== "function") {
      throw new Error("authService or getAuthService is required.");
    }
    this.authService = authService || null;
    this.getAuthService = typeof getAuthService === "function" ? getAuthService : null;
    this.devAuthBootstrapEnabled =
      typeof devAuthBootstrapEnabled === "boolean" ? devAuthBootstrapEnabled : null;
  }

  static get actionIds() {
    return AUTH_ACTION_IDS;
  }

  async register(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.REGISTER,
      input: payload
    });
  }

  async resendRegisterConfirmation(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.REGISTER_CONFIRMATION_RESEND,
      input: payload
    });
  }

  async login(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.LOGIN_PASSWORD,
      input: payload
    });
  }

  async requestOtpLogin(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.LOGIN_OTP_REQUEST,
      input: payload
    });
  }

  async verifyOtpLogin(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.LOGIN_OTP_VERIFY,
      input: payload
    });
  }

  async oauthStart(request, input) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.LOGIN_OAUTH_START,
      input
    });
  }

  async oauthComplete(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.LOGIN_OAUTH_COMPLETE,
      input: payload
    });
  }

  async devLoginAs(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.DEV_LOGIN_AS,
      input: payload
    });
  }

  resolveAuthService() {
    if (this.authService) {
      return this.authService;
    }
    if (typeof this.getAuthService !== "function") {
      throw new Error("authService is required.");
    }

    this.authService = this.getAuthService();
    if (!this.authService) {
      throw new Error("authService is required.");
    }
    return this.authService;
  }

  isDevLoginAsAvailable() {
    if (this.devAuthBootstrapEnabled != null) {
      return this.devAuthBootstrapEnabled === true;
    }
    const authService = this.resolveAuthService();
    return typeof authService?.isDevAuthBootstrapEnabled === "function"
      ? authService.isDevAuthBootstrapEnabled()
      : false;
  }

  async logout(request) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.LOGOUT
    });
  }

  async session(request) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.SESSION_READ
    });
  }

  async requestPasswordReset(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.PASSWORD_RESET_REQUEST,
      input: payload
    });
  }

  async completePasswordRecovery(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.PASSWORD_RECOVERY_COMPLETE,
      input: payload
    });
  }

  async resetPassword(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.PASSWORD_RESET,
      input: payload
    });
  }

  writeSessionCookies(reply, session) {
    if (session && reply) {
      this.resolveAuthService().writeSessionCookies(reply, session);
    }
  }

  clearSessionCookies(reply) {
    if (reply) {
      this.resolveAuthService().clearSessionCookies(reply);
    }
  }

  getOAuthProviderCatalogPayload() {
    const authService = this.resolveAuthService();
    const catalog =
      typeof authService.getOAuthProviderCatalog === "function"
        ? authService.getOAuthProviderCatalog()
        : null;
    const providers = Array.isArray(catalog?.providers)
      ? catalog.providers
          .map((provider) => ({
            id: String(provider?.id || "").trim().toLowerCase(),
            label: String(provider?.label || "").trim()
          }))
          .filter((provider) => provider.id && provider.label)
      : [];
    const defaultProvider = String(catalog?.defaultProvider || "").trim().toLowerCase();

    return {
      oauthProviders: providers,
      oauthDefaultProvider: providers.some((provider) => provider.id === defaultProvider)
        ? defaultProvider
        : null
    };
  }
}

export { AuthWebService };
