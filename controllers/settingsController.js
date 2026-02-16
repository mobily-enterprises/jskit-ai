function createSettingsController({ userSettingsService, authService }) {
  async function get(request, reply) {
    const response = await userSettingsService.getForUser(request, request.user);
    reply.code(200).send(response);
  }

  async function updateProfile(request, reply) {
    const payload = request.body || {};
    const result = await userSettingsService.updateProfile(request, request.user, payload);

    if (result.session) {
      authService.writeSessionCookies(reply, result.session);
    }

    reply.code(200).send(result.settings);
  }

  async function updatePreferences(request, reply) {
    const payload = request.body || {};
    const response = await userSettingsService.updatePreferences(request, request.user, payload);
    reply.code(200).send(response);
  }

  async function updateNotifications(request, reply) {
    const payload = request.body || {};
    const response = await userSettingsService.updateNotifications(request, request.user, payload);
    reply.code(200).send(response);
  }

  async function changePassword(request, reply) {
    const payload = request.body || {};
    const result = await userSettingsService.changePassword(request, payload);

    if (result.session) {
      authService.writeSessionCookies(reply, result.session);
    }

    reply.code(200).send({
      ok: true,
      message: result.message
    });
  }

  async function logoutOtherSessions(request, reply) {
    const response = await userSettingsService.logoutOtherSessions(request);
    reply.code(200).send(response);
  }

  return {
    get,
    updateProfile,
    updatePreferences,
    updateNotifications,
    changePassword,
    logoutOtherSessions
  };
}

export { createSettingsController };
