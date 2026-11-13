import { throwUnsupportedAuthOperation } from "@jskit-ai/auth-core/server/unsupportedOperation";
import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { AUTH_ACTION_IDS } from "../constants/authActionIds.js";

/**
 * The auth routes' service: it runs the auth actions for a request and
 * writes the installed auth service's cookies.
 */
class AuthWebService {
  /**
   * @param {object} dependencies
   * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService
   * @param {boolean} dependencies.devAuthBootstrapEnabled Whether dev login-as is offered.
   */
  constructor({ authService, devAuthBootstrapEnabled }) {
    this.authService = authService;
    this.devAuthBootstrapEnabled = devAuthBootstrapEnabled;
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

  async confirmRegistration(request, payload) {
    return request.executeAction({
      actionId: AUTH_ACTION_IDS.REGISTER_CONFIRM,
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

  isDevLoginAsAvailable() {
    return this.devAuthBootstrapEnabled;
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

  /**
   * Signs in the account a one-time signed pass names; a provider without pass sign-in refuses it as unsupported.
   * @param {{ pass: string }} input
   */
  async signInWithPass(input) {
    const { authService } = this;
    // readable-check: allow method-probe - optional operation: signInWithPass is an optional auth.service operation
    if (typeof authService.signInWithPass !== "function") {
      return throwUnsupportedAuthOperation("signInWithPass");
    }
    return authService.signInWithPass(input);
  }

  writeSessionCookies(reply, session) {
    if (session && reply) {
      this.authService.writeSessionCookies(reply, session);
    }
  }

  /**
   * Providers that bind an OAuth attempt to the browser (state, nonce, PKCE)
   * keep it in their own short-lived cookie; others need no hook.
   */
  writeOAuthStartCookies(reply, result) {
    const { authService } = this;
    // readable-check: allow method-probe - optional operation: writeOAuthStartCookies is an optional auth.service operation
    if (reply && typeof authService.writeOAuthStartCookies === "function") {
      authService.writeOAuthStartCookies(reply, result);
    }
  }

  clearOAuthStartCookies(reply) {
    const { authService } = this;
    // readable-check: allow method-probe - optional operation: clearOAuthStartCookies is an optional auth.service operation
    if (reply && typeof authService.clearOAuthStartCookies === "function") {
      authService.clearOAuthStartCookies(reply);
    }
  }

  clearSessionCookies(reply) {
    if (reply) {
      this.authService.clearSessionCookies(reply);
    }
  }

  getOAuthProviderCatalogPayload() {
    const capabilities = normalizeAuthCapabilities(this.authService.getCapabilities());
    const oauth = capabilities.features.oauthLogin;
    return {
      authCapabilities: capabilities,
      oauthProviders: oauth.enabled ? oauth.providers : [],
      oauthDefaultProvider: oauth.enabled ? oauth.defaultProvider : null
    };
  }
}

export { AuthWebService };
