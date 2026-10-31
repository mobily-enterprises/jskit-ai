import {
  emptyInputValidator
} from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { consoleSettingsResource } from "../../shared/resources/consoleSettingsResource.js";

/** @param {{ consoleSettingsService: import("./consoleSettingsService.js").ConsoleSettingsService }} dependencies */
function createConsoleSettingsActions({ consoleSettingsService }) {
  return Object.freeze([
    Object.freeze({
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
      extensions: {
        assistant: {
          exclude: "Application-owned console settings require an explicit assistant field allowlist; arbitrary configuration is not model-safe."
        }
      },
      idempotency: "none",
      execute: async (_input, context) => returnJsonApiData(await consoleSettingsService.getSettings({ context }))
    }),
    Object.freeze({
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
      extensions: {
        assistant: { exclude: "Application-owned console settings require an explicit assistant field allowlist; arbitrary configuration is not model-safe." },
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
      execute: async (input, context) => returnJsonApiData(await consoleSettingsService.updateSettings(input, { context }))
    })
  ]);
}

export { createConsoleSettingsActions };
