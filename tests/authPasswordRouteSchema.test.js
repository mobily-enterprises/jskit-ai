import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";

function buildStubControllers() {
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
        password: {
          canChange: true
        }
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

  function buildAnnuityPayload() {
    return {
      historyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      mode: "pv",
      timing: "ordinary",
      payment: "500.000000",
      annualRate: "6.000000",
      annualGrowthRate: "0.000000",
      years: null,
      paymentsPerYear: 12,
      periodicRate: "0.005000000000",
      periodicGrowthRate: "0.000000000000",
      totalPeriods: null,
      isPerpetual: true,
      value: "100000.000000000000",
      warnings: [],
      assumptions: {
        rateConversion: "Periodic discount rate = annualRate/100/paymentsPerYear.",
        timing: "Ordinary annuity assumes end-of-period payments.",
        growingAnnuity: "Growing annuity assumes a constant annual growth rate.",
        perpetuity: "Perpetual present value requires discount > growth."
      }
    };
  }

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
        reply.code(200).send({ authenticated: false, csrfToken: "test-csrf-token" });
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
        reply.code(200).send({ ok: true, message: "ok" });
      },
      async logoutOtherSessions(_request, reply) {
        reply.code(200).send({ ok: true, message: "ok" });
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
        reply.code(200).send(buildAnnuityPayload());
      }
    }
  };
}

test("password forgot route rejects invalid email", async () => {
  const app = Fastify();
  registerApiRoutes(app, { controllers: buildStubControllers() });

  const response = await app.inject({
    method: "POST",
    url: "/api/password/forgot",
    payload: {
      email: "not-an-email"
    }
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});

test("password recovery route accepts code payload", async () => {
  const app = Fastify();
  registerApiRoutes(app, { controllers: buildStubControllers() });

  const response = await app.inject({
    method: "POST",
    url: "/api/password/recovery",
    payload: {
      code: "recovery-code"
    }
  });

  assert.equal(response.statusCode, 200);
  await app.close();
});
