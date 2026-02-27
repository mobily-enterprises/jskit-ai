import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { createController as createAuthController } from "@jskit-ai/auth-fastify-adapter";
import { createController as createSettingsController } from "../server/modules/settings/controller.js";

function createReplyDouble() {
  return {
    statusCode: null,
    payload: null,
    redirectUrl: null,
    cookies: [],
    csrfToken: "csrf-token",
    code(status) {
      this.statusCode = status;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    },
    redirect(url) {
      this.statusCode = 302;
      this.redirectUrl = String(url || "");
      return this;
    },
    async generateCsrf() {
      return this.csrfToken;
    }
  };
}

test("auth controller covers register/login/logout/session/password flows via action executor", async () => {
  const actionCalls = [];
  const actionExecutor = {
    async execute({ actionId, input, context }) {
      actionCalls.push({ actionId, input, context });
      assert.equal(context.channel, "api");

      switch (actionId) {
        case "auth.register":
          if (input.email === "confirm@example.com") {
            return {
              requiresEmailConfirmation: true,
              profile: { displayName: "confirm-user" },
              session: null
            };
          }

          return {
            requiresEmailConfirmation: false,
            profile: { displayName: "new-user" },
            session: { access_token: "a", refresh_token: "b", expires_in: 3600 }
          };
        case "auth.login.password":
          return {
            profile: { displayName: "logged-user" },
            session: { access_token: "la", refresh_token: "lb", expires_in: 3600 }
          };
        case "auth.login.otp.request":
          return { ok: true };
        case "auth.login.otp.verify":
          return {
            profile: { displayName: "otp-user", email: "otp@example.com" },
            session: { access_token: "oa", refresh_token: "ob", expires_in: 3600 }
          };
        case "auth.login.oauth.start":
          return { url: "https://accounts.google.com/o/oauth2/v2/auth" };
        case "auth.login.oauth.complete":
          return {
            provider: "google",
            profile: {
              displayName: "oauth-user",
              email: "oauth@example.com"
            },
            session: { access_token: "ca", refresh_token: "cb", expires_in: 3600 }
          };
        case "auth.session.read":
          if (context.request.tokenState === "transient") {
            return { authenticated: false, clearSession: false, session: null, transientFailure: true };
          }
          if (context.request.tokenState === "none") {
            return { authenticated: false, clearSession: true, session: null, transientFailure: false };
          }
          return {
            authenticated: true,
            profile: { displayName: "session-user" },
            clearSession: false,
            session: { access_token: "sa", refresh_token: "sb", expires_in: 3600 },
            transientFailure: false
          };
        case "auth.password.reset.request":
          return { ok: true, message: "sent" };
        case "auth.password.recovery.complete":
          return {
            profile: { displayName: "recovered-user" },
            session: { access_token: "ra", refresh_token: "rb", expires_in: 3600 }
          };
        case "auth.password.reset":
          return { ok: true };
        case "auth.logout":
          return { clearSession: true };
        default:
          throw new Error(`Unhandled actionId: ${actionId}`);
      }
    }
  };

  const authService = {
    writeSessionCookies(reply, session) {
      reply.cookies.push(["write", session.access_token]);
    },
    clearSessionCookies(reply) {
      reply.cookies.push(["clear"]);
    }
  };

  const controller = createAuthController({ authService, actionExecutor });

  const registerConfirmReply = createReplyDouble();
  await controller.register({ body: { email: "confirm@example.com", password: "Password123" } }, registerConfirmReply);
  assert.equal(registerConfirmReply.statusCode, 201);
  assert.deepEqual(registerConfirmReply.payload, {
    ok: true,
    requiresEmailConfirmation: true,
    message: "Check your email to confirm the account before logging in."
  });

  const registerReply = createReplyDouble();
  await controller.register({ body: { email: "ok@example.com", password: "Password123" } }, registerReply);
  assert.equal(registerReply.statusCode, 201);
  assert.equal(registerReply.payload.username, "new-user");
  assert.equal(registerReply.cookies[0][0], "write");

  const loginReply = createReplyDouble();
  await controller.login({ body: { email: "ok@example.com", password: "Password123" } }, loginReply);
  assert.equal(loginReply.statusCode, 200);
  assert.equal(loginReply.payload.username, "logged-user");

  const otpRequestReply = createReplyDouble();
  await controller.requestOtpLogin(
    { body: { email: "otp@example.com", returnTo: "/w/acme/choice-2" } },
    otpRequestReply
  );
  assert.equal(otpRequestReply.statusCode, 200);
  assert.deepEqual(otpRequestReply.payload, { ok: true });

  const otpVerifyReply = createReplyDouble();
  await controller.verifyOtpLogin({ body: { email: "otp@example.com", token: "123456" } }, otpVerifyReply);
  assert.equal(otpVerifyReply.statusCode, 200);
  assert.equal(otpVerifyReply.payload.username, "otp-user");
  assert.equal(otpVerifyReply.cookies[0][0], "write");

  const oauthStartReply = createReplyDouble();
  await controller.oauthStart({ params: { provider: "google" } }, oauthStartReply);
  assert.equal(oauthStartReply.statusCode, 302);
  assert.equal(oauthStartReply.redirectUrl, "https://accounts.google.com/o/oauth2/v2/auth");

  const oauthCompleteReply = createReplyDouble();
  await controller.oauthComplete({ body: { provider: "google", code: "oauth-code" } }, oauthCompleteReply);
  assert.equal(oauthCompleteReply.statusCode, 200);
  assert.deepEqual(oauthCompleteReply.payload, {
    ok: true,
    provider: "google",
    username: "oauth-user",
    email: "oauth@example.com"
  });
  assert.equal(oauthCompleteReply.cookies[0][0], "write");

  const sessionTransientReply = createReplyDouble();
  await controller.session({ tokenState: "transient" }, sessionTransientReply);
  assert.equal(sessionTransientReply.statusCode, 503);
  assert.equal(sessionTransientReply.payload.csrfToken, "csrf-token");

  const sessionSignedOutReply = createReplyDouble();
  await controller.session({ tokenState: "none" }, sessionSignedOutReply);
  assert.equal(sessionSignedOutReply.statusCode, 200);
  assert.equal(sessionSignedOutReply.payload.authenticated, false);
  assert.equal(sessionSignedOutReply.cookies[0][0], "clear");

  const sessionSignedInReply = createReplyDouble();
  await controller.session({ tokenState: "ok" }, sessionSignedInReply);
  assert.equal(sessionSignedInReply.statusCode, 200);
  assert.equal(sessionSignedInReply.payload.authenticated, true);
  assert.equal(sessionSignedInReply.cookies[0][0], "write");

  const forgotReply = createReplyDouble();
  await controller.requestPasswordReset({ body: { email: "ok@example.com" } }, forgotReply);
  assert.equal(forgotReply.statusCode, 200);
  assert.equal(forgotReply.payload.ok, true);

  const recoveryReply = createReplyDouble();
  await controller.completePasswordRecovery({ body: { code: "abc" } }, recoveryReply);
  assert.equal(recoveryReply.statusCode, 200);
  assert.deepEqual(recoveryReply.payload, { ok: true });
  assert.equal(recoveryReply.cookies[0][0], "write");

  const resetReply = createReplyDouble();
  await controller.resetPassword(
    { body: { currentPassword: "old", newPassword: "new-password-123", confirmPassword: "new-password-123" } },
    resetReply
  );
  assert.equal(resetReply.statusCode, 200);
  assert.equal(resetReply.payload.ok, true);
  assert.equal(resetReply.cookies[0][0], "clear");

  const logoutReply = createReplyDouble();
  await controller.logout({}, logoutReply);
  assert.equal(logoutReply.statusCode, 200);
  assert.deepEqual(logoutReply.payload, { ok: true });
  assert.equal(logoutReply.cookies[0][0], "clear");

  const otpRequestActionCall = actionCalls.find((call) => call.actionId === "auth.login.otp.request");
  assert.equal(otpRequestActionCall?.input?.returnTo, "/w/acme/choice-2");

  assert.ok(actionCalls.length >= 12);
});

test("settings controller covers get/update/security flows via action executor", async () => {
  const actionCalls = [];
  const actionExecutor = {
    async execute({ actionId, input, context }) {
      actionCalls.push({ actionId, input, context });
      assert.equal(context.channel, "api");

      switch (actionId) {
        case "settings.read":
          return { profile: { displayName: "user", email: "user@example.com" } };
        case "settings.extensions.read":
          return {
            extensionId: "projects.preferences",
            fields: [{ id: "projects.defaultView" }],
            value: { defaultView: "list" }
          };
        case "settings.extensions.update":
          return {
            extensionId: "projects.preferences",
            fields: [{ id: "projects.defaultView" }],
            value: { defaultView: input.defaultView || "list" }
          };
        case "settings.profile.update":
          return {
            settings: { profile: { displayName: "updated", email: "user@example.com" } },
            session: { access_token: "profile-at", refresh_token: "rt", expires_in: 3600 }
          };
        case "settings.preferences.update":
          return { preferences: { theme: "dark" } };
        case "settings.notifications.update":
          return { notifications: { productUpdates: true } };
        case "settings.chat.update":
          return { chat: { publicChatId: "user7" } };
        case "settings.profile.avatar.upload":
          return { profile: { avatar: { hasUploadedAvatar: true } } };
        case "settings.profile.avatar.delete":
          return { profile: { avatar: { hasUploadedAvatar: false } } };
        case "settings.security.password.change":
          return {
            ok: true,
            message: "Password changed.",
            session: { access_token: "password-at", refresh_token: "rt", expires_in: 3600 }
          };
        case "settings.security.password_method.toggle":
          return { ok: true, method: "password" };
        case "settings.security.oauth.link.start":
          return { url: "https://accounts.google.com/o/oauth2/v2/auth" };
        case "settings.security.oauth.unlink":
          return { ok: true };
        case "settings.security.sessions.logout_others":
          return {
            ok: true,
            message: "Signed out from other active sessions."
          };
        default:
          throw new Error(`Unhandled actionId: ${actionId}`);
      }
    }
  };

  const authService = {
    writeSessionCookies(reply, session) {
      reply.cookies.push(["write", session.access_token]);
    }
  };

  const controller = createSettingsController({ actionExecutor, authService });

  const getReply = createReplyDouble();
  await controller.get({ user: { id: 7 } }, getReply);
  assert.equal(getReply.statusCode, 200);
  assert.equal(getReply.payload.profile.displayName, "user");

  const extensionReadReply = createReplyDouble();
  await controller.getExtension({ params: { extensionId: "projects.preferences" }, user: { id: 7 } }, extensionReadReply);
  assert.equal(extensionReadReply.statusCode, 200);
  assert.equal(extensionReadReply.payload.extensionId, "projects.preferences");
  assert.equal(extensionReadReply.payload.value.defaultView, "list");

  const extensionUpdateReply = createReplyDouble();
  await controller.updateExtension(
    { params: { extensionId: "projects.preferences" }, body: { defaultView: "board" }, user: { id: 7 } },
    extensionUpdateReply
  );
  assert.equal(extensionUpdateReply.statusCode, 200);
  assert.equal(extensionUpdateReply.payload.value.defaultView, "board");

  const profileReply = createReplyDouble();
  await controller.updateProfile({ body: { displayName: "updated" }, user: { id: 7 } }, profileReply);
  assert.equal(profileReply.statusCode, 200);
  assert.equal(profileReply.payload.profile.displayName, "updated");
  assert.equal(profileReply.cookies[0][1], "profile-at");

  const preferencesReply = createReplyDouble();
  await controller.updatePreferences({ body: { theme: "dark" }, user: { id: 7 } }, preferencesReply);
  assert.equal(preferencesReply.statusCode, 200);
  assert.equal(preferencesReply.payload.preferences.theme, "dark");

  const notificationsReply = createReplyDouble();
  await controller.updateNotifications({ body: { productUpdates: true }, user: { id: 7 } }, notificationsReply);
  assert.equal(notificationsReply.statusCode, 200);
  assert.equal(notificationsReply.payload.notifications.productUpdates, true);

  const chatReply = createReplyDouble();
  await controller.updateChat({ body: { publicChatId: "user7" }, user: { id: 7 } }, chatReply);
  assert.equal(chatReply.statusCode, 200);
  assert.equal(chatReply.payload.chat.publicChatId, "user7");

  const uploadAvatarReply = createReplyDouble();
  await controller.uploadAvatar(
    {
      user: { id: 7 },
      async file() {
        return {
          file: {},
          mimetype: "image/png",
          filename: "avatar.png",
          fields: {
            uploadDimension: { value: "256" }
          }
        };
      }
    },
    uploadAvatarReply
  );
  assert.equal(uploadAvatarReply.statusCode, 200);
  assert.equal(uploadAvatarReply.payload.profile.avatar.hasUploadedAvatar, true);

  const deleteAvatarReply = createReplyDouble();
  await controller.deleteAvatar({ user: { id: 7 } }, deleteAvatarReply);
  assert.equal(deleteAvatarReply.statusCode, 200);
  assert.equal(deleteAvatarReply.payload.profile.avatar.hasUploadedAvatar, false);

  const passwordReply = createReplyDouble();
  await controller.changePassword(
    { user: { id: 7 }, body: { currentPassword: "old", newPassword: "new-password-123", confirmPassword: "new-password-123" } },
    passwordReply
  );
  assert.equal(passwordReply.statusCode, 200);
  assert.equal(passwordReply.payload.ok, true);
  assert.equal(passwordReply.cookies[0][1], "password-at");

  const passwordMethodReply = createReplyDouble();
  await controller.setPasswordMethodEnabled({ body: { enabled: true }, user: { id: 7 } }, passwordMethodReply);
  assert.equal(passwordMethodReply.statusCode, 200);
  assert.equal(passwordMethodReply.payload.ok, true);

  const oauthStartReply = createReplyDouble();
  await controller.startOAuthProviderLink(
    { params: { provider: "google" }, query: { returnTo: "/settings/security" }, user: { id: 7 } },
    oauthStartReply
  );
  assert.equal(oauthStartReply.statusCode, 302);
  assert.equal(oauthStartReply.redirectUrl, "https://accounts.google.com/o/oauth2/v2/auth");

  const oauthUnlinkReply = createReplyDouble();
  await controller.unlinkOAuthProvider({ params: { provider: "google" }, user: { id: 7 } }, oauthUnlinkReply);
  assert.equal(oauthUnlinkReply.statusCode, 200);
  assert.equal(oauthUnlinkReply.payload.ok, true);

  const logoutOthersReply = createReplyDouble();
  await controller.logoutOtherSessions({ user: { id: 7 } }, logoutOthersReply);
  assert.equal(logoutOthersReply.statusCode, 200);
  assert.equal(logoutOthersReply.payload.ok, true);

  const missingAvatarReply = createReplyDouble();
  await assert.rejects(
    () => controller.uploadAvatar({ user: { id: 7 }, file: async () => null }, missingAvatarReply),
    (error) => {
      assert.equal(error instanceof AppError, true);
      assert.equal(error.status, 400);
      return true;
    }
  );

  assert.ok(actionCalls.length >= 14);
});
