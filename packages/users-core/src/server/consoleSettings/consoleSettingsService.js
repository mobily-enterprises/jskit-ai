import { createAuthorizedService } from "@jskit-ai/kernel/server/runtime";

function buildSettingsResponse(record = {}) {
  return {
    settings: {
      assistantSystemPromptWorkspace: String(record.assistantSystemPromptWorkspace || "")
    }
  };
}

function createService({ consoleSettingsRepository } = {}) {
  const servicePermissions = Object.freeze({
    getSettings: Object.freeze({
      require: "authenticated"
    }),
    updateSettings: Object.freeze({
      require: "authenticated"
    })
  });

  async function getSettings(options = {}) {
    const settings = await consoleSettingsRepository.getSingleton();

    return buildSettingsResponse(settings);
  }

  async function updateSettings(input = {}, options = {}) {
    const settings = await consoleSettingsRepository.updateSingleton({
      assistantSystemPromptWorkspace: input.assistantSystemPromptWorkspace
    });

    return buildSettingsResponse(settings);
  }

  return createAuthorizedService(
    {
      getSettings,
      updateSettings
    },
    servicePermissions
  );
}

export { createService };
