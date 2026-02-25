import { AppError } from "@jskit-ai/server-runtime-core/errors";

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

async function executeAction(actionExecutor, { actionId, request, input = {} }) {
  return actionExecutor.execute({
    actionId,
    input,
    context: {
      request,
      channel: "api"
    }
  });
}

function createController({ authService, actionExecutor }) {
  if (!authService) {
    throw new Error("authService is required.");
  }
  if (!actionExecutor || typeof actionExecutor.execute !== "function") {
    throw new Error("actionExecutor.execute is required.");
  }

  async function get(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.READ,
      request
    });
    reply.code(200).send(response);
  }

  async function updateProfile(request, reply) {
    const payload = request.body || {};
    const result = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.PROFILE_UPDATE,
      request,
      input: payload
    });

    if (result.session) {
      authService.writeSessionCookies(reply, result.session);
    }

    reply.code(200).send(result.settings);
  }

  async function updatePreferences(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.PREFERENCES_UPDATE,
      request,
      input: payload
    });
    reply.code(200).send(response);
  }

  async function updateNotifications(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.NOTIFICATIONS_UPDATE,
      request,
      input: payload
    });
    reply.code(200).send(response);
  }

  async function updateChat(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.CHAT_UPDATE,
      request,
      input: payload
    });
    reply.code(200).send(response);
  }

  async function uploadAvatar(request, reply) {
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

    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.PROFILE_AVATAR_UPLOAD,
      request,
      input: {
        stream: filePart.file,
        mimeType: filePart.mimetype,
        fileName: filePart.filename,
        uploadDimension
      }
    });
    reply.code(200).send(response);
  }

  async function deleteAvatar(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.PROFILE_AVATAR_DELETE,
      request
    });
    reply.code(200).send(response);
  }

  async function changePassword(request, reply) {
    const payload = request.body || {};
    const result = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.PASSWORD_CHANGE,
      request,
      input: payload
    });

    if (result.session) {
      authService.writeSessionCookies(reply, result.session);
    }

    reply.code(200).send({
      ok: true,
      message: result.message
    });
  }

  async function setPasswordMethodEnabled(request, reply) {
    const payload = request.body || {};
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.PASSWORD_METHOD_TOGGLE,
      request,
      input: payload
    });

    reply.code(200).send(response);
  }

  async function startOAuthProviderLink(request, reply) {
    const provider = request.params?.provider;
    const returnTo = request.query?.returnTo;
    const result = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.OAUTH_LINK_START,
      request,
      input: {
        provider,
        returnTo
      }
    });
    reply.redirect(result.url);
  }

  async function unlinkOAuthProvider(request, reply) {
    const provider = request.params?.provider;
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.OAUTH_UNLINK,
      request,
      input: {
        provider
      }
    });

    reply.code(200).send(response);
  }

  async function logoutOtherSessions(request, reply) {
    const response = await executeAction(actionExecutor, {
      actionId: SETTINGS_ACTION_IDS.SESSIONS_LOGOUT_OTHERS,
      request
    });
    reply.code(200).send(response);
  }

  return {
    get,
    updateProfile,
    updatePreferences,
    updateNotifications,
    updateChat,
    uploadAvatar,
    deleteAvatar,
    changePassword,
    setPasswordMethodEnabled,
    startOAuthProviderLink,
    unlinkOAuthProvider,
    logoutOtherSessions
  };
}

export { createController };
