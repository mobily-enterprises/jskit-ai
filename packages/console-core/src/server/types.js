// The types of the console capabilities, for features that require them.

/** @typedef {ReturnType<typeof import("./consoleRuntime.js").createConsoleRuntime>} ConsoleCore */
/** @typedef {ReturnType<typeof import("./consoleSettings/consoleSettingsRepository.js").createRepository>} ConsoleSettings The console's settings record, read with getSingleton: `console.settings`. */

/**
 * The console access service: who owns the console.
 * @typedef {ReturnType<typeof import("./consoleSettings/consoleService.js").createService>} ConsoleService
 */
/**
 * The console settings repository: the one console_settings row.
 * @typedef {ReturnType<typeof import("./consoleSettings/consoleSettingsRepository.js").createRepository>} ConsoleSettingsRepository
 */
/**
 * The console settings service: `services.settings` of `console.core`.
 * @typedef {ReturnType<typeof import("./consoleSettings/consoleSettingsService.js").createService>} ConsoleSettingsService
 */

export {};
