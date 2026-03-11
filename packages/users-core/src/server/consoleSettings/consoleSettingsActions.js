import {
  EMPTY_INPUT_CONTRACT,
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
    visibility: "public",
    input: EMPTY_INPUT_CONTRACT,
    output: consoleSettingsResource.operations.view.output,
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
    input: consoleSettingsResource.operations.replace.body,
    output: consoleSettingsResource.operations.replace.output,
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
