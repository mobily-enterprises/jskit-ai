import {
  EMPTY_INPUT_CONTRACT,
  normalizeObject,
  OBJECT_INPUT_SCHEMA,
  requireAuthenticated
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

const consoleSettingsActions = Object.freeze([
  {
    id: "console.settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "console",
    visibility: "public",
    input: [EMPTY_INPUT_CONTRACT],
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "console.settings.read"
    },
    observability: {},
    async execute(_input, _context, deps) {
      return deps.consoleSettingsService.getSettings();
    }
  },
  {
    id: "console.settings.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "console",
    visibility: "public",
    input: [{ schema: OBJECT_INPUT_SCHEMA }],
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "console.settings.update"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.consoleSettingsService.updateSettings(normalizeObject(input));
    }
  }
]);

export { consoleSettingsActions };
