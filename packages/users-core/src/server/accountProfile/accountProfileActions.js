import {
  EMPTY_INPUT_CONTRACT,
  requireAuthenticated,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { settingsProfileUpdateCommand } from "../../shared/settingsProfileUpdateCommand.js";
import { settingsAvatarUploadCommand } from "../../shared/settingsAvatarUploadCommand.js";
import { settingsAvatarDeleteCommand } from "../../shared/settingsAvatarDeleteCommand.js";

const accountProfileActions = Object.freeze([
  {
    id: "settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    visibility: "public",
    input: EMPTY_INPUT_CONTRACT,
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
    visibility: "public",
    input: settingsProfileUpdateCommand.operation.body,
    output: settingsProfileUpdateCommand.operation.response,
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
    visibility: "public",
    input: settingsAvatarUploadCommand.operation.body,
    output: settingsAvatarUploadCommand.operation.response,
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
    visibility: "public",
    input: settingsAvatarDeleteCommand.operation.body,
    output: settingsAvatarDeleteCommand.operation.response,
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
