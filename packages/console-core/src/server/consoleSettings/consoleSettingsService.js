import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";

function buildSettingsResponse(record = {}) {
  return {
    settings: {
      ...(record?.settings && typeof record.settings === "object" ? record.settings : {})
    }
  };
}

/**
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./consoleSettingsRepository.js").createRepository>} dependencies.consoleSettingsRepository
 * @param {ReturnType<typeof import("./consoleService.js").createService>} dependencies.consoleService
 */
function createService({ consoleSettingsRepository, consoleService }) {
  async function getSettings(options = {}) {
    await consoleService.requireConsoleOwner(options?.context, options);
    const settings = await consoleSettingsRepository.getSingleton();

    return returnJsonApiData(buildSettingsResponse(settings));
  }

  async function updateSettings(input, options = {}) {
    await consoleService.requireConsoleOwner(options?.context, options);
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
