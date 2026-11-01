import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import {
  emptyInputValidator,
  resolveRequest
} from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { userProfileResource } from "../../shared/resources/userProfileResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

const settingsProfileUpdateInputValidator = deepFreeze({
  schema: userProfileResource.operations.patch.body.schema,
  mode: userProfileResource.operations.patch.body.mode
});

/** @param {{ accountProfileService: import("../types.js").AccountProfileService }} dependencies */
function createAccountProfileActions({ accountProfileService }) {
  return Object.freeze([
    Object.freeze({
      id: "settings.read",
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: emptyInputValidator,
      output: null,
      extensions: {
        assistant: {
          description: "Read the signed-in user’s profile, preferences, notifications and security status.",
          output: userSettingsResource.operations.view.output,
          transformResult: (result) => result.value
        }
      },
      idempotency: "none",
      execute: (input, context) => accountProfileService.getForUser(resolveRequest(context), resolveActionUser(context, input))
    }),
    Object.freeze({
      id: "settings.profile.update",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: settingsProfileUpdateInputValidator,
      output: null,
      extensions: {
        assistant: {
          description: "Update the signed-in user’s display name.",
          output: userSettingsResource.operations.view.output,
          transformResult: (result) => result.response.value
        }
      },
      idempotency: "optional",
      events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
      execute: (input, context) => accountProfileService.updateProfile(
        resolveRequest(context),
        resolveActionUser(context, input),
        input
      )
    }),
    Object.freeze({
      id: "settings.profile.avatar.upload",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: userProfileResource.operations.avatarUpload.body,
      output: null,
      extensions: {
        assistant: {
          exclude: "Use the authenticated account profile file picker; upload streams must not enter assistant arguments."
        }
      },
      idempotency: "none",
      events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
      execute: (input, context) => accountProfileService.uploadAvatar(
        resolveRequest(context),
        resolveActionUser(context, input),
        input
      )
    }),
    Object.freeze({
      id: "settings.profile.avatar.delete",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: userProfileResource.operations.avatarDelete.body,
      output: null,
      extensions: {
        assistant: {
          description: "Remove the signed-in user’s uploaded avatar.",
          output: userSettingsResource.operations.view.output,
          transformResult: (result) => result.value
        }
      },
      idempotency: "none",
      events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
      execute: (input, context) => accountProfileService.deleteAvatar(resolveRequest(context), resolveActionUser(context, input))
    })
  ]);
}

export { createAccountProfileActions };
