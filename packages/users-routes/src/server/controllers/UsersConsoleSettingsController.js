const CONSOLE_SETTINGS_ACTION_IDS = Object.freeze({
  READ: "console.settings.read",
  UPDATE: "console.settings.update"
});

class UsersConsoleSettingsController {
  async get(request, reply) {
    const response = await request.executeAction({
      actionId: CONSOLE_SETTINGS_ACTION_IDS.READ
    });
    reply.code(200).send(response);
  }

  async update(request, reply) {
    const response = await request.executeAction({
      actionId: CONSOLE_SETTINGS_ACTION_IDS.UPDATE,
      input: request.input.body
    });
    reply.code(200).send(response);
  }
}

export { UsersConsoleSettingsController, CONSOLE_SETTINGS_ACTION_IDS };
