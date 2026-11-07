import {
  emptyInputValidator
} from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { consoleSettingsContract } from "../../shared/resources/consoleSettingsResource.js";

/** @param {{ consoleSettingsService: import("../types.js").ConsoleSettingsService }} dependencies */
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
      execute: (_input, context) => consoleSettingsService.getSettings({ context })
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
      input: consoleSettingsContract.operations.replace.body,
      output: null,
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
      execute: (_input, context) => consoleSettingsService.updateSettings({ context })
    })
  ]);
}

export { createConsoleSettingsActions };
