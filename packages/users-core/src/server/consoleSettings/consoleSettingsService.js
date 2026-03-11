function buildSettingsResponse(record = {}) {
  return {
    settings: {
      assistantSystemPromptWorkspace: String(record.assistantSystemPromptWorkspace || "")
    }
  };
}

function createService({ consoleSettingsRepository } = {}) {
  async function getSettings() {
    const settings = await consoleSettingsRepository.getSingleton();

    return buildSettingsResponse(settings);
  }

  async function updateSettings(input = {}) {
    const settings = await consoleSettingsRepository.updateSingleton({
      assistantSystemPromptWorkspace: input.assistantSystemPromptWorkspace
    });

    return buildSettingsResponse(settings);
  }

  return Object.freeze({
    getSettings,
    updateSettings
  });
}

export { createService };
