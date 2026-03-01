const AUTH_ACTION_IDS = Object.freeze({
  REGISTER: "auth.register",
  LOGIN_PASSWORD: "auth.login.password",
  LOGIN_OTP_REQUEST: "auth.login.otp.request",
  LOGIN_OTP_VERIFY: "auth.login.otp.verify",
  LOGIN_OAUTH_START: "auth.login.oauth.start",
  LOGIN_OAUTH_COMPLETE: "auth.login.oauth.complete",
  LOGOUT: "auth.logout",
  SESSION_READ: "auth.session.read",
  PASSWORD_RESET_REQUEST: "auth.password.reset.request",
  PASSWORD_RECOVERY_COMPLETE: "auth.password.recovery.complete",
  PASSWORD_RESET: "auth.password.reset"
});

async function executeAction(actionExecutor, { actionId, request, input = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      requestMeta: {
        request
      },
      request,
      channel: "api"
    }
  });
}

function createController({ authService, actionExecutor }) {
  if (!authService) {
    throw new Error("authService is required.");
  }
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }

  function getOAuthProviderCatalogPayload() {
    const catalog =
      typeof authService.getOAuthProviderCatalog === "function" ? authService.getOAuthProviderCatalog() : null;
    const providers = Array.isArray(catalog?.providers)
      ? catalog.providers
          .map((provider) => ({
            id: String(provider?.id || "")
              .trim()
              .toLowerCase(),
            label: String(provider?.label || "")
              .trim()
          }))
          .filter((provider) => provider.id && provider.label)
      : [];
    const defaultProvider = String(catalog?.defaultProvider || "")
      .trim()
      .toLowerCase();

    return {
      oauthProviders: providers,
      oauthDefaultProvider: providers.some((provider) => provider.id === defaultProvider) ? defaultProvider : null
    };
  }

  async function register(request, reply) {
    const payload = request.body || {};
    const result = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.REGISTER,
      request,
      input: payload
    });

    if (result.session) {
      authService.writeSessionCookies(reply, result.session);
    }

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

  async function login(request, reply) {
    const payload = request.body || {};
    const result = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.LOGIN_PASSWORD,
      request,
      input: payload
    });

    authService.writeSessionCookies(reply, result.session);

    reply.code(200).send({
      ok: true,
      username: result.profile.displayName
    });
  }

  async function requestOtpLogin(request, reply) {
    const payload = request.body || {};
    const result = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.LOGIN_OTP_REQUEST,
      request,
      input: payload
    });
    reply.code(200).send(result);
  }

  async function verifyOtpLogin(request, reply) {
    const payload = request.body || {};
    const result = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.LOGIN_OTP_VERIFY,
      request,
      input: payload
    });

    authService.writeSessionCookies(reply, result.session);
    reply.code(200).send({
      ok: true,
      username: result.profile.displayName,
      email: result.profile.email
    });
  }

  async function oauthStart(request, reply) {
    const provider = request.params?.provider;
    const returnTo = request.query?.returnTo;
    const result = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.LOGIN_OAUTH_START,
      request,
      input: {
        provider,
        returnTo
      }
    });
    reply.redirect(result.url);
  }

  async function oauthComplete(request, reply) {
    const payload = request.body || {};
    const result = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.LOGIN_OAUTH_COMPLETE,
      request,
      input: payload
    });
    authService.writeSessionCookies(reply, result.session);

    reply.code(200).send({
      ok: true,
      provider: result.provider,
      username: result.profile.displayName,
      email: result.profile.email
    });
  }

  async function logout(request, reply) {
    const result = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.LOGOUT,
      request
    });
    if (result?.clearSession) {
      authService.clearSessionCookies(reply);
    }

    reply.code(200).send({
      ok: true
    });
  }

  async function session(request, reply) {
    const csrfToken = await reply.generateCsrf();
    const oauthCatalogPayload = getOAuthProviderCatalogPayload();
    const authResult = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.SESSION_READ,
      request
    });

    if (authResult.clearSession) {
      authService.clearSessionCookies(reply);
    }
    if (authResult.session) {
      authService.writeSessionCookies(reply, authResult.session);
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

  async function requestPasswordReset(request, reply) {
    const payload = request.body || {};
    const result = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.PASSWORD_RESET_REQUEST,
      request,
      input: payload
    });
    reply.code(200).send(result);
  }

  async function completePasswordRecovery(request, reply) {
    const payload = request.body || {};
    const result = await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.PASSWORD_RECOVERY_COMPLETE,
      request,
      input: payload
    });
    authService.writeSessionCookies(reply, result.session);
    reply.code(200).send({
      ok: true
    });
  }

  async function resetPassword(request, reply) {
    const payload = request.body || {};
    await executeAction(actionExecutor, {
      actionId: AUTH_ACTION_IDS.PASSWORD_RESET,
      request,
      input: payload
    });
    authService.clearSessionCookies(reply);
    reply.code(200).send({
      ok: true,
      message: "Password updated. Sign in with your new password."
    });
  }

  return {
    register,
    login,
    requestOtpLogin,
    verifyOtpLogin,
    oauthStart,
    oauthComplete,
    logout,
    session,
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword
  };
}

export { createController };
