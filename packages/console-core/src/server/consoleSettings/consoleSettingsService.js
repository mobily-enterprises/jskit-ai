import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";

function buildSettingsResponse(record) {
  return {
    settings: {
      ...(record?.settings && typeof record.settings === "object" ? record.settings : {})
    }
  };
}

/**
 * @param {object} dependencies
 * @param {import("../types.js").ConsoleSettingsRepository} dependencies.consoleSettingsRepository
 * @param {import("../types.js").ConsoleService} dependencies.consoleService
 */
function createService({ consoleSettingsRepository, consoleService }) {
  async function getSettings({ context }) {
    await consoleService.requireConsoleOwner(context);
    const settings = await consoleSettingsRepository.getSingleton();

    return returnJsonApiData(buildSettingsResponse(settings));
  }

  async function updateSettings(input, { context }) {
    await consoleService.requireConsoleOwner(context);
    const settings = await consoleSettingsRepository.updateSingleton(input);

    return returnJsonApiData(buildSettingsResponse(settings));
  }

  return Object.freeze({
    getSettings,
    updateSettings
  });
}

/** @typedef {ReturnType<typeof createService>} ConsoleSettingsService */

export { createService };
