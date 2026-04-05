import {
  EMPTY_INPUT_VALIDATOR,
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { userProfileResource } from "../../shared/resources/userProfileResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

const settingsProfileUpdateOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      settings: userSettingsResource.operations.view.outputValidator.schema,
      session: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()])
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      settings: userSettingsResource.operations.view.outputValidator.normalize(source.settings),
      session: source.session && typeof source.session === "object" ? source.session : null
    };
  }
});

const accountProfileActions = Object.freeze([
  {
    id: "settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    inputValidator: EMPTY_INPUT_VALIDATOR,
    outputValidator: userSettingsResource.operations.view.outputValidator,
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
    inputValidator: {
      payload: userProfileResource.operations.patch.bodyValidator
    },
    outputValidator: settingsProfileUpdateOutputValidator,
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
    inputValidator: userProfileResource.operations.avatarUpload.bodyValidator,
    outputValidator: userProfileResource.operations.avatarUpload.outputValidator,
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
    inputValidator: userProfileResource.operations.avatarDelete.bodyValidator,
    outputValidator: userProfileResource.operations.avatarDelete.outputValidator,
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
