import { Type } from "@fastify/type-provider-typebox";
import { userProfileSchema as userProfileResourceSchema } from "../../../shared/contracts/resources/userProfileSchema.js";
import {
  userSettingsSchema as userSettingsResourceSchema,
  preferencesPatchBodySchema,
  notificationsPatchBodySchema,
  chatPatchBodySchema
} from "../../../shared/contracts/resources/userSettingsSchema.js";
import { settingsPasswordChangeCommand } from "../../../shared/contracts/commands/settingsPasswordChangeCommand.js";
import { settingsPasswordMethodToggleCommand } from "../../../shared/contracts/commands/settingsPasswordMethodToggleCommand.js";
import { settingsOAuthLinkStartCommand } from "../../../shared/contracts/commands/settingsOAuthLinkStartCommand.js";
import { settingsOAuthUnlinkCommand } from "../../../shared/contracts/commands/settingsOAuthUnlinkCommand.js";
import { settingsLogoutOtherSessionsCommand } from "../../../shared/contracts/commands/settingsLogoutOtherSessionsCommand.js";
import { settingsAvatarUploadCommand } from "../../../shared/contracts/commands/settingsAvatarUploadCommand.js";
import { settingsAvatarDeleteCommand } from "../../../shared/contracts/commands/settingsAvatarDeleteCommand.js";

const settingsRoutesContract = Object.freeze({
  body: {
    profile: userProfileResourceSchema.operations.replace.body.schema,
    preferences: preferencesPatchBodySchema,
    notifications: notificationsPatchBodySchema,
    chat: chatPatchBodySchema,
    changePassword: settingsPasswordChangeCommand.operation.body.schema,
    passwordMethodToggle: settingsPasswordMethodToggleCommand.operation.body.schema
  },
  response: userSettingsResourceSchema.operations.view.response.schema,
  resources: {
    userProfile: userProfileResourceSchema,
    userSettings: userSettingsResourceSchema
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
