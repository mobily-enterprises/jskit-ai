import { Type } from "@fastify/type-provider-typebox";
import { userProfileResource } from "../../../shared/resources/userProfileResource.js";
import {
  userSettingsResource,
  preferencesPatchBodySchema,
  notificationsPatchBodySchema,
  chatPatchBodySchema
} from "../../../shared/resources/userSettingsResource.js";
import { settingsPasswordChangeCommand } from "../../../shared/contracts/commands/settingsPasswordChangeCommand.js";
import { settingsPasswordMethodToggleCommand } from "../../../shared/contracts/commands/settingsPasswordMethodToggleCommand.js";
import { settingsOAuthLinkStartCommand } from "../../../shared/contracts/commands/settingsOAuthLinkStartCommand.js";
import { settingsOAuthUnlinkCommand } from "../../../shared/contracts/commands/settingsOAuthUnlinkCommand.js";
import { settingsLogoutOtherSessionsCommand } from "../../../shared/contracts/commands/settingsLogoutOtherSessionsCommand.js";
import { settingsAvatarUploadCommand } from "../../../shared/contracts/commands/settingsAvatarUploadCommand.js";
import { settingsAvatarDeleteCommand } from "../../../shared/contracts/commands/settingsAvatarDeleteCommand.js";

const settingsRoutesContract = Object.freeze({
  body: {
    profile: userProfileResource.operations.replace.body.schema,
    preferences: preferencesPatchBodySchema,
    notifications: notificationsPatchBodySchema,
    chat: chatPatchBodySchema,
    changePassword: settingsPasswordChangeCommand.operation.body.schema,
    passwordMethodToggle: settingsPasswordMethodToggleCommand.operation.body.schema
  },
  response: userSettingsResource.operations.view.response.schema,
  resources: {
    userProfile: userProfileResource,
    userSettings: userSettingsResource
  },
  commands: {
    "settings.security.password.change": settingsPasswordChangeCommand,
    "settings.security.password_method.toggle": settingsPasswordMethodToggleCommand,
    "settings.security.oauth.link.start": settingsOAuthLinkStartCommand,
    "settings.security.oauth.unlink": settingsOAuthUnlinkCommand,
    "settings.security.sessions.logout_others": settingsLogoutOtherSessionsCommand,
    "settings.profile.avatar.upload": settingsAvatarUploadCommand,
    "settings.profile.avatar.delete": settingsAvatarDeleteCommand
  },
  redirect: {
    oauthStart: Type.Object(
      {
        location: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    )
  }
});

export { settingsRoutesContract };
