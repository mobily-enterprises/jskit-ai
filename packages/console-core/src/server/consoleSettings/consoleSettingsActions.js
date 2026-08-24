import {
  emptyInputValidator
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { consoleSettingsResource } from "../../shared/resources/consoleSettingsResource.js";

const consoleSettingsActionSpecifications = Object.freeze([
  {
    id: "console.settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["console"],
    permission: {
      require: "authenticated"
    },
    input: emptyInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "console.settings.read"
    },
    observability: {},
    async run(consoleSettingsService, _input, context) {
      return returnJsonApiData(await consoleSettingsService.getSettings({
        context
      }));
    }
  },
  {
    id: "console.settings.update",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["console"],
    permission: {
      require: "authenticated"
    },
    input: consoleSettingsResource.operations.replace.body,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: "console.settings.update"
    },
    observability: {},
    extensions: {
      realtime: {
        event: "console.settings.changed",
        audience: "all_users"
      }
    },
    events: [createEntityChangedActionEvent({
      source: "console",
      entity: "settings",
      operation: "updated",
      entityId: 1,
      realtime: {
        event: "console.settings.changed",
        audience: "all_users"
      }
    })],
    async run(consoleSettingsService, input, context) {
      return returnJsonApiData(await consoleSettingsService.updateSettings(input, {
        context
      }));
    }
  }
]);

function buildConsoleSettingsActions({ consoleSettingsService } = {}) {
  if (!consoleSettingsService) {
    throw new TypeError("buildConsoleSettingsActions requires consoleSettingsService.");
  }
  return consoleSettingsActionSpecifications.map(({ run, ...definition }) => Object.freeze({
    ...definition,
    execute(input, context) {
      return run(consoleSettingsService, input, context);
    }
  }));
}

export { consoleSettingsActionSpecifications, buildConsoleSettingsActions };
