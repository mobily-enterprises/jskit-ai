import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

const SETTINGS_ACTION_IDS = Object.freeze({
  READ: "settings.read",
  PROFILE_UPDATE: "settings.profile.update",
  PROFILE_AVATAR_UPLOAD: "settings.profile.avatar.upload",
  PROFILE_AVATAR_DELETE: "settings.profile.avatar.delete",
  PREFERENCES_UPDATE: "settings.preferences.update",
  NOTIFICATIONS_UPDATE: "settings.notifications.update",
  CHAT_UPDATE: "settings.chat.update",
  PASSWORD_CHANGE: "settings.security.password.change",
  PASSWORD_METHOD_TOGGLE: "settings.security.password_method.toggle",
  OAUTH_LINK_START: "settings.security.oauth.link.start",
  OAUTH_UNLINK: "settings.security.oauth.unlink",
  SESSIONS_LOGOUT_OTHERS: "settings.security.sessions.logout_others"
});

class UsersSettingsController {
  constructor({ authService } = {}) {
    if (!authService) {
      throw new Error("UsersSettingsController requires authService.");
    }

    this.authService = authService;
  }

  async get(request, reply) {
    const response = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.READ
    });
    reply.code(200).send(response);
  }

  async updateProfile(request, reply) {
    const result = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.PROFILE_UPDATE,
      input: request.input.body
    });

    if (result?.session && typeof this.authService.writeSessionCookies === "function") {
      this.authService.writeSessionCookies(reply, result.session);
    }

    reply.code(200).send(result?.settings || result);
  }

  async updatePreferences(request, reply) {
    const response = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.PREFERENCES_UPDATE,
      input: request.input.body
    });
    reply.code(200).send(response);
  }

  async updateNotifications(request, reply) {
    const response = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.NOTIFICATIONS_UPDATE,
      input: request.input.body
    });
    reply.code(200).send(response);
  }

  async updateChat(request, reply) {
    const response = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.CHAT_UPDATE,
      input: request.input.body
    });
    reply.code(200).send(response);
  }

  async uploadAvatar(request, reply) {
    const filePart = await request.file();
    if (!filePart) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            avatar: "Avatar file is required."
          }
        }
      });
    }

    const uploadDimension = filePart.fields?.uploadDimension?.value;
    const response = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.PROFILE_AVATAR_UPLOAD,
      input: {
        stream: filePart.file,
        mimeType: filePart.mimetype,
        fileName: filePart.filename,
        uploadDimension
      }
    });

    reply.code(200).send(response);
  }

  async deleteAvatar(request, reply) {
    const response = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.PROFILE_AVATAR_DELETE
    });
    reply.code(200).send(response);
  }

  async changePassword(request, reply) {
    const result = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.PASSWORD_CHANGE,
      input: request.input.body
    });

    if (result?.session && typeof this.authService.writeSessionCookies === "function") {
      this.authService.writeSessionCookies(reply, result.session);
    }

    reply.code(200).send({
      ok: true,
      message: result?.message || "Password updated."
    });
  }

  async setPasswordMethodEnabled(request, reply) {
    const response = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.PASSWORD_METHOD_TOGGLE,
      input: request.input.body
    });

    reply.code(200).send(response);
  }

  async startOAuthProviderLink(request, reply) {
    const result = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.OAUTH_LINK_START,
      input: {
        provider: request.input.params.provider,
        returnTo: request.input.query.returnTo
      }
    });

    reply.redirect(result.url);
  }

  async unlinkOAuthProvider(request, reply) {
    const response = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.OAUTH_UNLINK,
      input: {
        provider: request.input.params.provider
      }
    });

    reply.code(200).send(response);
  }

  async logoutOtherSessions(request, reply) {
    const response = await request.executeAction({
      actionId: SETTINGS_ACTION_IDS.SESSIONS_LOGOUT_OTHERS
    });
    reply.code(200).send(response);
  }
}

export { UsersSettingsController, SETTINGS_ACTION_IDS };
