function createAuthController({ authService }) {
  async function register(request, reply) {
    const payload = request.body || {};
    const result = await authService.register(payload);
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
    const result = await authService.login(payload);
    authService.writeSessionCookies(reply, result.session);

    reply.code(200).send({
      ok: true,
      username: result.profile.displayName
    });
  }

  async function oauthStart(request, reply) {
    const provider = request.params?.provider;
    const result = await authService.oauthStart({ provider });
    reply.redirect(result.url);
  }

  async function oauthComplete(request, reply) {
    const payload = request.body || {};
    const result = await authService.oauthComplete(payload);
    authService.writeSessionCookies(reply, result.session);

    reply.code(200).send({
      ok: true,
      provider: result.provider,
      username: result.profile.displayName,
      email: result.profile.email
    });
  }

  async function logout(_request, reply) {
    authService.clearSessionCookies(reply);
    reply.code(200).send({ ok: true });
  }

  async function session(request, reply) {
    const csrfToken = await reply.generateCsrf();
    const authResult = await authService.authenticateRequest(request);
    if (authResult.clearSession) {
      authService.clearSessionCookies(reply);
    }
    if (authResult.session) {
      authService.writeSessionCookies(reply, authResult.session);
    }

    if (authResult.transientFailure) {
      reply.code(503).send({
        error: "Authentication service temporarily unavailable. Please retry.",
        csrfToken
      });
      return;
    }

    if (!authResult.authenticated) {
      reply.code(200).send({
        authenticated: false,
        csrfToken
      });
      return;
    }

    reply.code(200).send({
      authenticated: true,
      username: authResult.profile.displayName,
      csrfToken
    });
  }

  async function requestPasswordReset(request, reply) {
    const payload = request.body || {};
    const result = await authService.requestPasswordReset(payload);
    reply.code(200).send(result);
  }

  async function completePasswordRecovery(request, reply) {
    const payload = request.body || {};
    const result = await authService.completePasswordRecovery(payload);
    authService.writeSessionCookies(reply, result.session);
    reply.code(200).send({
      ok: true
    });
  }

  async function resetPassword(request, reply) {
    const payload = request.body || {};
    await authService.resetPassword(request, payload);
    authService.clearSessionCookies(reply);
    reply.code(200).send({
      ok: true,
      message: "Password updated. Sign in with your new password."
    });
  }

  return {
    register,
    login,
    oauthStart,
    oauthComplete,
    logout,
    session,
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword
  };
}

export { createAuthController };
