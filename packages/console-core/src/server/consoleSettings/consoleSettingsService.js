import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";

// The settings record as the console settings resource answers it.
function buildSettingsResponse(record) {
  return {
    settings: { ...record.settings }
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

  // The console settings have no fields, so an update only touches the row.
  async function updateSettings({ context }) {
    await consoleService.requireConsoleOwner(context);
    const settings = await consoleSettingsRepository.updateSingleton();

    return returnJsonApiData(buildSettingsResponse(settings));
  }

  return Object.freeze({
    getSettings,
    updateSettings
  });
}

export { createService };
