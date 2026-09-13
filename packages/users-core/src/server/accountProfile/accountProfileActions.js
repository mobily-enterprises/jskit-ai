import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import {
  emptyInputValidator,
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { userProfileResource } from "../../shared/resources/userProfileResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

const settingsProfileUpdateInputValidator = deepFreeze({
  schema: userProfileResource.operations.patch.body.schema,
  mode: userProfileResource.operations.patch.body.mode
});

const accountProfileActionSpecifications = deepFreeze([
  {
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
    audit: {
      actionName: "settings.read"
    },
    observability: {},
    async run(accountProfileService, input, context) {
      return accountProfileService.getForUser(resolveRequest(context), resolveActionUser(context, input), {
        context
      });
    }
  },
  {
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
    audit: {
      actionName: "settings.profile.update"
    },
    observability: {},
    events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
    async run(accountProfileService, input, context) {
      return accountProfileService.updateProfile(
        resolveRequest(context),
        resolveActionUser(context, input),
        input,
        {
          context
        }
      );
    }
  },
  {
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
    audit: {
      actionName: "settings.profile.avatar.upload"
    },
    observability: {},
    events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
    async run(accountProfileService, input, context) {
      const avatarUpload = {
        stream: input.stream,
        mimeType: input.mimeType,
        fileName: input.fileName,
        uploadDimension: input.uploadDimension
      };

      return accountProfileService.uploadAvatar(
        resolveRequest(context),
        resolveActionUser(context, input),
        avatarUpload,
        {
          context
        }
      );
    }
  },
  {
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
    audit: {
      actionName: "settings.profile.avatar.delete"
    },
    observability: {},
    events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
    async run(accountProfileService, input, context) {
      return accountProfileService.deleteAvatar(
        resolveRequest(context),
        resolveActionUser(context, input),
        {
          context
        }
      );
    }
  }
]);

function buildAccountProfileActions({ accountProfileService } = {}) {
  if (!accountProfileService) throw new TypeError("buildAccountProfileActions requires accountProfileService.");
  return accountProfileActionSpecifications.map(({ run, ...definition }) => Object.freeze({
    ...definition,
    execute(input, context) {
      return run(accountProfileService, input, context);
    }
  }));
}

export { accountProfileActionSpecifications, buildAccountProfileActions };
