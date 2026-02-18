import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerApiRoutes } from "../routes/api/index.js";

function buildSettingsPayload() {
  return {
    profile: {
      displayName: "demo-user",
      email: "demo@example.com",
      emailManagedBy: "supabase",
      emailChangeFlow: "supabase",
      avatar: {
        uploadedUrl: null,
        gravatarUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
        effectiveUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
        hasUploadedAvatar: false,
        size: 64,
        version: null
      }
    },
    security: {
      mfa: {
        status: "not_enabled",
        enrolled: false,
        methods: []
      },
      sessions: {
        canSignOutOtherDevices: true
      },
      authPolicy: {
        minimumEnabledMethods: 1,
        enabledMethodsCount: 2
      },
      authMethods: [
        {
          id: "password",
          kind: "password",
          provider: "email",
          label: "Password",
          configured: true,
          enabled: true,
          canEnable: false,
          canDisable: true,
          supportsSecretUpdate: true,
          requiresCurrentPassword: true
        },
        {
          id: "email_otp",
          kind: "otp",
          provider: "email",
          label: "Email one-time code",
          configured: true,
          enabled: true,
          canEnable: false,
          canDisable: false,
          supportsSecretUpdate: false,
          requiresCurrentPassword: false
        }
      ]
    },
    preferences: {
      theme: "system",
      locale: "en-US",
      timeZone: "UTC",
      dateFormat: "system",
      numberFormat: "system",
      currencyCode: "USD",
      defaultMode: "fv",
      defaultTiming: "ordinary",
      defaultPaymentsPerYear: 12,
      defaultHistoryPageSize: 10,
      avatarSize: 64
    },
    notifications: {
      productUpdates: true,
      accountActivity: true,
      securityAlerts: true
    }
  };
}

function buildStubControllers() {
  return {
    auth: {
      async register(_request, reply) {
        reply.code(201).send({ ok: true, requiresEmailConfirmation: false, username: "demo-user" });
      },
      async login(_request, reply) {
        reply.code(200).send({ ok: true, username: "demo-user" });
      },
      async requestPasswordReset(_request, reply) {
        reply.code(200).send({ ok: true, message: "ok" });
      },
      async oauthStart(_request, reply) {
        reply.code(302).send();
      },
      async oauthComplete(request, reply) {
        const code = String(request?.body?.code || "").trim();
        const accessToken = String(request?.body?.accessToken || "").trim();
        const refreshToken = String(request?.body?.refreshToken || "").trim();
        const hasSessionPair = Boolean(accessToken && refreshToken);
        if (!code && !hasSessionPair) {
          reply.code(400).send({ ok: false, message: "missing token material" });
          return;
        }

        reply.code(200).send({
          ok: true,
          provider: "google",
          username: "demo-user",
          email: "demo@example.com"
        });
      },
      async completePasswordRecovery(_request, reply) {
        reply.code(200).send({ ok: true });
      },
      async resetPassword(_request, reply) {
        reply.code(200).send({ ok: true, message: "ok" });
      },
      async logout(_request, reply) {
        reply.code(200).send({ ok: true });
      },
      async session(_request, reply) {
        reply.code(200).send({ authenticated: true, username: "demo-user", csrfToken: "csrf" });
      }
    },
    settings: {
      async get(_request, reply) {
        reply.code(200).send(buildSettingsPayload());
      },
      async updateProfile(_request, reply) {
        reply.code(200).send(buildSettingsPayload());
      },
      async uploadAvatar(_request, reply) {
        reply.code(200).send(buildSettingsPayload());
      },
      async deleteAvatar(_request, reply) {
        reply.code(200).send(buildSettingsPayload());
      },
      async updatePreferences(_request, reply) {
        reply.code(200).send(buildSettingsPayload());
      },
      async updateNotifications(_request, reply) {
        reply.code(200).send(buildSettingsPayload());
      },
      async changePassword(_request, reply) {
        reply.code(200).send({ ok: true, message: "Password changed." });
      },
      async logoutOtherSessions(_request, reply) {
        reply.code(200).send({ ok: true, message: "Signed out from other active sessions." });
      }
    },
    history: {
      async list(_request, reply) {
        reply.code(200).send({
          entries: [],
          page: 1,
          pageSize: 10,
          total: 0,
          totalPages: 1
        });
      }
    },
    annuity: {
      async calculate(_request, reply) {
        reply.code(200).send({
          historyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          mode: "pv",
          timing: "ordinary",
          payment: "1",
          annualRate: "1",
          annualGrowthRate: "0",
          years: null,
          paymentsPerYear: 1,
          periodicRate: "1",
          periodicGrowthRate: "0",
          totalPeriods: null,
          isPerpetual: true,
          value: "1",
          warnings: [],
          assumptions: {
            rateConversion: "x",
            timing: "y",
            growingAnnuity: "z",
            perpetuity: "k"
          }
        });
      }
    }
  };
}

test("settings get route returns expected payload", async () => {
  const app = Fastify();
  registerApiRoutes(app, { controllers: buildStubControllers() });

  const response = await app.inject({
    method: "GET",
    url: "/api/settings"
  });

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.payload);
  assert.equal(payload.profile.emailManagedBy, "supabase");
  await app.close();
});

test("settings profile route validates display name input", async () => {
  const app = Fastify();
  registerApiRoutes(app, { controllers: buildStubControllers() });

  const invalid = await app.inject({
    method: "PATCH",
    url: "/api/settings/profile",
    payload: {
      displayName: ""
    }
  });
  assert.equal(invalid.statusCode, 400);

  const valid = await app.inject({
    method: "PATCH",
    url: "/api/settings/profile",
    payload: {
      displayName: "valid-name"
    }
  });
  assert.equal(valid.statusCode, 200);
  await app.close();
});

test("settings security routes validate password payload and allow logout-others", async () => {
  const app = Fastify();
  registerApiRoutes(app, { controllers: buildStubControllers() });

  const invalidPassword = await app.inject({
    method: "POST",
    url: "/api/settings/security/change-password",
    payload: {
      currentPassword: "",
      newPassword: "short",
      confirmPassword: "short"
    }
  });
  assert.equal(invalidPassword.statusCode, 400);

  const validPassword = await app.inject({
    method: "POST",
    url: "/api/settings/security/change-password",
    payload: {
      currentPassword: "old-password",
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    }
  });
  assert.equal(validPassword.statusCode, 200);

  const logoutOthers = await app.inject({
    method: "POST",
    url: "/api/settings/security/logout-others"
  });
  assert.equal(logoutOthers.statusCode, 200);

  await app.close();
});

test("oauth complete route accepts strict camelCase payload shape only", async () => {
  const app = Fastify();
  registerApiRoutes(app, { controllers: buildStubControllers() });

  const valid = await app.inject({
    method: "POST",
    url: "/api/oauth/complete",
    payload: {
      provider: "google",
      accessToken: "access-token",
      refreshToken: "refresh-token"
    }
  });
  assert.equal(valid.statusCode, 200);

  const invalidSnakeCase = await app.inject({
    method: "POST",
    url: "/api/oauth/complete",
    payload: {
      provider: "google",
      access_token: "access-token",
      refresh_token: "refresh-token"
    }
  });
  assert.equal(invalidSnakeCase.statusCode, 400);

  await app.close();
});
