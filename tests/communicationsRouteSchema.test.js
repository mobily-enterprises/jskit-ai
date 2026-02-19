import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";

function createNoopReply() {
  return {
    code() {
      return this;
    },
    send() {
      return this;
    }
  };
}

function buildControllers() {
  const noop = async (_request, reply) => {
    const nextReply = reply || createNoopReply();
    nextReply.code(200).send({ ok: true });
  };

  return {
    auth: {
      register: noop,
      login: noop,
      requestOtpLogin: noop,
      verifyOtpLogin: noop,
      oauthStart: noop,
      oauthComplete: noop,
      requestPasswordReset: noop,
      completePasswordRecovery: noop,
      resetPassword: noop,
      logout: noop,
      session: noop
    },
    settings: {
      get: noop,
      updateProfile: noop,
      uploadAvatar: noop,
      deleteAvatar: noop,
      updatePreferences: noop,
      updateNotifications: noop,
      changePassword: noop,
      setPasswordMethodEnabled: noop,
      startOAuthProviderLink: noop,
      unlinkOAuthProvider: noop,
      logoutOtherSessions: noop
    },
    history: {
      list: noop
    },
    annuity: {
      calculate: noop
    },
    communications: {
      async sendSms(_request, reply) {
        reply.code(200).send({
          sent: false,
          reason: "not_configured",
          provider: "none",
          messageId: null
        });
      }
    },
    workspace: {},
    projects: {}
  };
}

test("communications sms route accepts E.164 payload", async () => {
  const app = Fastify();
  registerApiRoutes(app, {
    controllers: buildControllers()
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/workspace/sms/send",
    payload: {
      to: "+15551234567",
      text: "Hello from scaffold"
    }
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.payload);
  assert.equal(payload.reason, "not_configured");
  await app.close();
});

test("communications sms route rejects invalid phone number payload", async () => {
  const app = Fastify();
  registerApiRoutes(app, {
    controllers: buildControllers()
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/workspace/sms/send",
    payload: {
      to: "5551234",
      text: "Hello from scaffold"
    }
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});
