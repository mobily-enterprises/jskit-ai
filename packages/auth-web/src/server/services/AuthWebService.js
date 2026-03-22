import { AUTH_ACTION_IDS } from "../constants/authActionIds.js";

class AuthWebService {
  constructor({ authService } = {}) {
    if (!authService) {
      throw new Error("authService is required.");
    }
    this.authService = authService;
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
