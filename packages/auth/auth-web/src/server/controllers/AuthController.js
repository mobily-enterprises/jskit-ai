import { AUTH_ACTION_IDS } from "../constants/authActionIds.js";
import { AuthWebService } from "../services/AuthWebService.js";

class AuthController {
  constructor({ service } = {}) {
    if (!service) {
      throw new Error("AuthController requires AuthWebService instance.");
    }
    this.service = service;
  }

  getOAuthProviderCatalogPayload() {
    return this.service.getOAuthProviderCatalogPayload();
  }

  async register(request, reply) {
    const payload = request.body || {};
    const result = await this.service.register(request, payload);

    this.service.writeSessionCookies(reply, result.session);

    if (result.requiresEmailConfirmation) {
      reply.code(201).send({
        ok: true,
        requiresEmailConfirmation: true,
        message: "Check your email to confirm the account before logging in."
      });
      return;
    }

    reply.code(201).send({
      ok: true,
      username: result.profile.displayName,
      requiresEmailConfirmation: false
    });
  }

  async login(request, reply) {
    const payload = request.body || {};
    const result = await this.service.login(request, payload);

    this.service.writeSessionCookies(reply, result.session);

    reply.code(200).send({
      ok: true,
      username: result.profile.displayName
    });
  }

  async requestOtpLogin(request, reply) {
    const payload = request.body || {};
    const result = await this.service.requestOtpLogin(request, payload);
    reply.code(200).send(result);
  }

  async verifyOtpLogin(request, reply) {
    const payload = request.body || {};
    const result = await this.service.verifyOtpLogin(request, payload);

    this.service.writeSessionCookies(reply, result.session);
    reply.code(200).send({
      ok: true,
      username: result.profile.displayName,
      email: result.profile.email
    });
  }

  async oauthStart(request, reply) {
    const provider = request.params?.provider;
    const returnTo = request.query?.returnTo;
    const result = await this.service.oauthStart(request, { provider, returnTo });
    reply.redirect(result.url);
  }

  async oauthComplete(request, reply) {
    const payload = request.body || {};
    const result = await this.service.oauthComplete(request, payload);
    this.service.writeSessionCookies(reply, result.session);

    reply.code(200).send({
      ok: true,
      provider: result.provider,
      username: result.profile.displayName,
      email: result.profile.email
    });
  }

  async logout(request, reply) {
    const result = await this.service.logout(request);
    if (result?.clearSession) {
      this.service.clearSessionCookies(reply);
    }

    reply.code(200).send({
      ok: true
    });
  }

  async session(request, reply) {
    const csrfToken = await reply.generateCsrf();
    const oauthCatalogPayload = this.getOAuthProviderCatalogPayload();
    const authResult = await this.service.session(request);

    if (authResult.clearSession) {
      this.service.clearSessionCookies(reply);
    }
    if (authResult.session) {
      this.service.writeSessionCookies(reply, authResult.session);
    }

    if (authResult.transientFailure) {
      reply.code(503).send({
        error: "Authentication service temporarily unavailable. Please retry.",
        csrfToken,
        ...oauthCatalogPayload
      });
      return;
    }

    if (!authResult.authenticated) {
      reply.code(200).send({
        authenticated: false,
        csrfToken,
        ...oauthCatalogPayload
      });
      return;
    }

    reply.code(200).send({
      authenticated: true,
      username: authResult.profile.displayName,
      csrfToken,
      ...oauthCatalogPayload
    });
  }

  async requestPasswordReset(request, reply) {
    const payload = request.body || {};
    const result = await this.service.requestPasswordReset(request, payload);
    reply.code(200).send(result);
  }

  async completePasswordRecovery(request, reply) {
    const payload = request.body || {};
    const result = await this.service.completePasswordRecovery(request, payload);
    this.service.writeSessionCookies(reply, result.session);
    reply.code(200).send({
      ok: true
    });
  }

  async resetPassword(request, reply) {
    const payload = request.body || {};
    await this.service.resetPassword(request, payload);
    this.service.clearSessionCookies(reply);
    reply.code(200).send({
      ok: true,
      message: "Password updated. Sign in with your new password."
    });
  }
}

function createController({ service, authService, actionExecutor } = {}) {
  if (!service) {
    if (!authService) {
      throw new Error("createController requires either service or authService.");
    }
    service = new AuthWebService({ authService, actionExecutor });
  }
  return new AuthController({ service });
}

export { AuthController, AUTH_ACTION_IDS, createController };
