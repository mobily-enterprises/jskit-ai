import {
  EMPTY_INPUT_VALIDATOR,
  requireAuthenticated,
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
      settings: userSettingsResource.operations.view.output.schema,
      session: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()])
    },
    { additionalProperties: false }
  ),
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);

    return {
      settings: userSettingsResource.operations.view.output.normalize(source.settings),
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
    input: EMPTY_INPUT_VALIDATOR,
    output: userSettingsResource.operations.view.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.getForUser(resolveRequest(context), resolveUser(context, input));
    }
  },
  {
    id: "settings.profile.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    input: userProfileResource.operations.patch.body,
    output: settingsProfileUpdateOutputValidator,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "settings.profile.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.updateProfile(
        resolveRequest(context),
        resolveUser(context, input),
        input
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
    input: userProfileResource.operations.avatarUpload.body,
    output: userProfileResource.operations.avatarUpload.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.profile.avatar.upload"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.uploadAvatar(
        resolveRequest(context),
        resolveUser(context, input),
        input
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
    input: userProfileResource.operations.avatarDelete.body,
    output: userProfileResource.operations.avatarDelete.output,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "settings.profile.avatar.delete"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountProfileService.deleteAvatar(
        resolveRequest(context),
        resolveUser(context, input),
        input
      );
    }
  }
]);

export { accountProfileActions };
