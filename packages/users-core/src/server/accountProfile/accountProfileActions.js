import { createSchema } from "json-rest-schema";
import {
  EMPTY_INPUT_VALIDATOR,
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { userProfileResource } from "../../shared/resources/userProfileResource.js";
import { userSettingsOutputSchema } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

const settingsProfileUpdateOutputValidator = deepFreeze({
  schema: createSchema({
    settings: {
      type: "object",
      required: true,
      schema: userSettingsOutputSchema
    },
    session: {
      type: "object",
      required: true,
      nullable: true,
      additionalProperties: true
    }
  }),
  mode: "replace"
});

const accountProfileActions = deepFreeze([
  {
    id: "settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: EMPTY_INPUT_VALIDATOR,
    output: userSettingsResource.operations.view.output,
    idempotency: "none",
    audit: {
      actionName: "settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.getForUser(resolveRequest(context), resolveActionUser(context, input), {
        context
      });
    }
  },
  {
    id: "settings.profile.update",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: {
      payload: userProfileResource.operations.patch.body
    },
    output: settingsProfileUpdateOutputValidator,
    idempotency: "optional",
    audit: {
      actionName: "settings.profile.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.updateProfile(
        resolveRequest(context),
        resolveActionUser(context, input),
        input.payload,
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
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: userProfileResource.operations.avatarUpload.body,
    output: userProfileResource.operations.avatarUpload.output,
    idempotency: "none",
    audit: {
      actionName: "settings.profile.avatar.upload"
    },
    observability: {},
    async execute(input, context, deps) {
      const avatarUpload = {
        stream: input.stream,
        mimeType: input.mimeType,
        fileName: input.fileName,
        uploadDimension: input.uploadDimension
      };

      return deps.accountProfileService.uploadAvatar(
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
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: userProfileResource.operations.avatarDelete.body,
    output: userProfileResource.operations.avatarDelete.output,
    idempotency: "none",
    audit: {
      actionName: "settings.profile.avatar.delete"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.deleteAvatar(
        resolveRequest(context),
        resolveActionUser(context, input),
        {
          context
        }
      );
    }
  }
]);

export { accountProfileActions };
