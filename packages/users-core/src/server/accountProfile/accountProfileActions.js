import {
  EMPTY_INPUT_VALIDATOR,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { userProfileResource } from "../../shared/resources/userProfileResource.js";

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
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    inputValidator: EMPTY_INPUT_VALIDATOR,
    outputValidator: userSettingsResource.operations.view.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.getForUser(resolveRequest(context), resolveUser(context, input), {
        context
      });
    }
  },
  {
    id: "settings.profile.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    inputValidator: userProfileResource.operations.patch.bodyValidator,
    outputValidator: settingsProfileUpdateOutputValidator,
    idempotency: "optional",
    audit: {
      actionName: "settings.profile.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.updateProfile(
        resolveRequest(context),
        resolveUser(context, input),
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
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    inputValidator: userProfileResource.operations.avatarUpload.bodyValidator,
    outputValidator: userProfileResource.operations.avatarUpload.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "settings.profile.avatar.upload"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.uploadAvatar(
        resolveRequest(context),
        resolveUser(context, input),
        input,
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
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
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
        resolveUser(context, input),
        input,
        {
          context
        }
      );
    }
  }
]);

export { accountProfileActions };
