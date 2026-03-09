import { Type } from "@fastify/type-provider-typebox";
import { userProfileSchema as userProfileResourceSchema } from "@jskit-ai/users-core/shared/contracts/resources/userProfileSchema";
import {
  userSettingsSchema as userSettingsResourceSchema,
  preferencesPatchBodySchema,
  notificationsPatchBodySchema,
  chatPatchBodySchema
} from "@jskit-ai/users-core/shared/contracts/resources/userSettingsSchema";
import { settingsPasswordChangeCommand } from "@jskit-ai/users-core/shared/contracts/commands/settingsPasswordChangeCommand";
import { settingsPasswordMethodToggleCommand } from "@jskit-ai/users-core/shared/contracts/commands/settingsPasswordMethodToggleCommand";
import {
  settingsOAuthLinkStartCommand,
  settingsOAuthProviderParamsSchema,
  settingsOAuthProviderQuerySchema
} from "@jskit-ai/users-core/shared/contracts/commands/settingsOAuthLinkStartCommand";
import { settingsOAuthUnlinkCommand } from "@jskit-ai/users-core/shared/contracts/commands/settingsOAuthUnlinkCommand";
import { settingsLogoutOtherSessionsCommand } from "@jskit-ai/users-core/shared/contracts/commands/settingsLogoutOtherSessionsCommand";
import { settingsAvatarUploadCommand } from "@jskit-ai/users-core/shared/contracts/commands/settingsAvatarUploadCommand";
import { settingsAvatarDeleteCommand } from "@jskit-ai/users-core/shared/contracts/commands/settingsAvatarDeleteCommand";

const schema = Object.freeze({
  body: {
    profile: userProfileResourceSchema.operations.replace.body.schema,
    preferences: preferencesPatchBodySchema,
    notifications: notificationsPatchBodySchema,
    chat: chatPatchBodySchema,
    changePassword: settingsPasswordChangeCommand.operation.body.schema,
    passwordMethodToggle: settingsPasswordMethodToggleCommand.operation.body.schema
  },
  params: {
    oauthProvider: settingsOAuthProviderParamsSchema
  },
  query: {
    oauthProvider: settingsOAuthProviderQuerySchema
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

export { schema };
