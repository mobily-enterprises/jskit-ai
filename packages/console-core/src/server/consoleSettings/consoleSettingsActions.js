import {
  EMPTY_INPUT_VALIDATOR
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { consoleSettingsResource } from "../../shared/resources/consoleSettingsResource.js";

const consoleSettingsActions = Object.freeze([
  {
    id: "console.settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "console",
    permission: {
      require: "authenticated"
    },
    input: EMPTY_INPUT_VALIDATOR,
    output: consoleSettingsResource.operations.view.output,
    idempotency: "none",
    audit: {
      actionName: "console.settings.read"
    },
    observability: {},
    async execute(_input, context, deps) {
      return deps.consoleSettingsService.getSettings({
        context
      });
    }
  },
  {
    id: "console.settings.update",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "console",
    permission: {
      require: "authenticated"
    },
    input: {
      payload: consoleSettingsResource.operations.replace.body
    },
    output: consoleSettingsResource.operations.replace.output,
    idempotency: "optional",
    audit: {
      actionName: "console.settings.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.consoleSettingsService.updateSettings(input.payload, {
        context
      });
    }
  }
]);

export { consoleSettingsActions };
