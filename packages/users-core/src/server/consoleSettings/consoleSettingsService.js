function buildSettingsResponse(record = {}) {
  return {
    settings: {
      assistantSystemPromptWorkspace: String(record.assistantSystemPromptWorkspace || "")
    }
  };
}

function createService({ consoleSettingsRepository, consoleService } = {}) {
  if (!consoleSettingsRepository || typeof consoleSettingsRepository.getSingleton !== "function") {
    throw new Error("consoleSettingsService requires consoleSettingsRepository.getSingleton().");
  }
  if (!consoleSettingsRepository || typeof consoleSettingsRepository.updateSingleton !== "function") {
    throw new Error("consoleSettingsService requires consoleSettingsRepository.updateSingleton().");
  }
  if (!consoleService || typeof consoleService.requireConsoleOwner !== "function") {
    throw new Error("consoleSettingsService requires consoleService.requireConsoleOwner().");
  }

  async function getSettings(options = {}) {
    await consoleService.requireConsoleOwner(options?.context, options);
    const settings = await consoleSettingsRepository.getSingleton();

    return buildSettingsResponse(settings);
  }

  async function updateSettings(input = {}, options = {}) {
    await consoleService.requireConsoleOwner(options?.context, options);
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
