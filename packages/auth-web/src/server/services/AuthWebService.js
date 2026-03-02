import { AUTH_ACTION_IDS } from "../constants/authActionIds.js";

class AuthWebService {
  constructor({ authService, actionExecutor } = {}) {
    if (!authService) {
      throw new Error("authService is required.");
    }
    if (!actionExecutor || typeof actionExecutor.execute !== "function") {
      throw new Error("actionExecutor.execute is required.");
    }
    this.authService = authService;
    this.actionExecutor = actionExecutor;
  }

  static get actionIds() {
    return AUTH_ACTION_IDS;
  }

  async executeAction(actionId, request, input = {}) {
    return this.actionExecutor.execute({
      actionId,
      input,
      context: {
        requestMeta: { request },
        request,
        channel: "api"
      }
    });
  }

  async register(request, payload) {
    return this.executeAction(AUTH_ACTION_IDS.REGISTER, request, payload);
  }

  async login(request, payload) {
    return this.executeAction(AUTH_ACTION_IDS.LOGIN_PASSWORD, request, payload);
  }

  async requestOtpLogin(request, payload) {
    return this.executeAction(AUTH_ACTION_IDS.LOGIN_OTP_REQUEST, request, payload);
  }

  async verifyOtpLogin(request, payload) {
    return this.executeAction(AUTH_ACTION_IDS.LOGIN_OTP_VERIFY, request, payload);
  }

  async oauthStart(request, input) {
    return this.executeAction(AUTH_ACTION_IDS.LOGIN_OAUTH_START, request, input);
  }

  async oauthComplete(request, payload) {
    return this.executeAction(AUTH_ACTION_IDS.LOGIN_OAUTH_COMPLETE, request, payload);
  }

  async logout(request) {
    return this.executeAction(AUTH_ACTION_IDS.LOGOUT, request);
  }

  async session(request) {
    return this.executeAction(AUTH_ACTION_IDS.SESSION_READ, request);
  }

  async requestPasswordReset(request, payload) {
    return this.executeAction(AUTH_ACTION_IDS.PASSWORD_RESET_REQUEST, request, payload);
  }

  async completePasswordRecovery(request, payload) {
    return this.executeAction(AUTH_ACTION_IDS.PASSWORD_RECOVERY_COMPLETE, request, payload);
  }

  async resetPassword(request, payload) {
    return this.executeAction(AUTH_ACTION_IDS.PASSWORD_RESET, request, payload);
  }

  writeSessionCookies(reply, session) {
    if (session && reply) {
      this.authService.writeSessionCookies(reply, session);
    }
  }

  clearSessionCookies(reply) {
    if (reply) {
      this.authService.clearSessionCookies(reply);
    }
  }

  getOAuthProviderCatalogPayload() {
    const catalog =
      typeof this.authService.getOAuthProviderCatalog === "function"
        ? this.authService.getOAuthProviderCatalog()
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
