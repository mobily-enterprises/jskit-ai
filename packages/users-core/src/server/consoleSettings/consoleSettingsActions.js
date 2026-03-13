import {
  EMPTY_INPUT_VALIDATOR,
  requireAuthenticated
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { consoleSettingsResource } from "../../shared/resources/consoleSettingsResource.js";

const consoleSettingsActions = Object.freeze([
  {
    id: "console.settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "console",
    consoleUsersOnly: false,
    inputValidator: EMPTY_INPUT_VALIDATOR,
    outputValidator: consoleSettingsResource.operations.view.outputValidator,
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
    consoleUsersOnly: false,
    inputValidator: consoleSettingsResource.operations.replace.bodyValidator,
    outputValidator: consoleSettingsResource.operations.replace.outputValidator,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "console.settings.update"
    },
    observability: {},
    async execute(input, _context, deps) {
      return deps.consoleSettingsService.updateSettings(input);
    }
  }
]);

export { consoleSettingsActions };
