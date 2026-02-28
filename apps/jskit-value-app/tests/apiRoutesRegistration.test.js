import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";

function noopControllers() {
  const settingsPayload = {
    profile: {
      displayName: "u",
      email: "u@example.com",
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
    },
    chat: {
      publicChatId: "u",
      allowWorkspaceDms: true,
      allowGlobalDms: false,
      requireSharedWorkspaceForGlobalDm: true,
      discoverableByPublicChatId: false
    }
  };

  const fallbackController = new Proxy(
    async (_request, reply) => {
      if (reply && typeof reply.code === "function") {
        reply.code(200).send({ ok: true });
      }
    },
    {
      get() {
        return fallbackController;
      }
    }
  );

  return new Proxy(
    {
      auth: {
        async register(_request, reply) {
          reply.code(201).send({ ok: true, requiresEmailConfirmation: false, username: "u" });
        },
        async login(_request, reply) {
          reply.code(200).send({ ok: true, username: "u" });
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
          reply.code(200).send({ authenticated: false, csrfToken: "csrf" });
        }
      },
      settings: {
        async get(_request, reply) {
          reply.code(200).send(settingsPayload);
        },
        async updateProfile(_request, reply) {
          reply.code(200).send(settingsPayload);
        },
        async uploadAvatar(_request, reply) {
          reply.code(200).send(settingsPayload);
        },
        async deleteAvatar(_request, reply) {
          reply.code(200).send(settingsPayload);
        },
        async updatePreferences(_request, reply) {
          reply.code(200).send(settingsPayload);
        },
        async updateNotifications(_request, reply) {
          reply.code(200).send(settingsPayload);
        },
        async updateChat(_request, reply) {
          reply.code(200).send(settingsPayload);
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
          reply.code(200).send({ entries: [], page: 1, pageSize: 10, total: 0, totalPages: 1 });
        }
      }
    },
    {
      get(target, prop, receiver) {
        if (Reflect.has(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }
        return fallbackController;
      }
    }
  );
}

test("registerApiRoutes supports custom routes and route defaults", async () => {
  const app = Fastify();
  let capturedMeta = null;

  registerApiRoutes(app, {
    controllers: noopControllers(),
    routes: [
      {
        path: "/api/v1/custom",
        method: "GET",
        handler: async (request, reply, url) => {
          capturedMeta = {
            authPolicy: request.routeOptions.config.authPolicy,
            ownerParam: request.routeOptions.config.ownerParam,
            userField: request.routeOptions.config.userField,
            ownerResolverType: typeof request.routeOptions.config.ownerResolver,
            csrfProtection: request.routeOptions.config.csrfProtection,
            urlPath: url.pathname
          };
          reply.code(200).send({ ok: true });
        }
      },
      {
        path: "/api/v1/custom-with-schema",
        method: "GET",
        auth: "own",
        ownerParam: "id",
        userField: "id",
        ownerResolver: () => "id-1",
        csrfProtection: false,
        schema: {
          querystring: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        },
        rateLimit: {
          max: 1,
          timeWindow: "1 minute"
        },
        handler: async (_request, reply) => {
          reply.code(200).send({ ok: true });
        }
      }
    ]
  });

  const first = await app.inject({ method: "GET", url: "/api/v1/custom" });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(capturedMeta, {
    authPolicy: "public",
    ownerParam: null,
    userField: "id",
    ownerResolverType: "object",
    csrfProtection: true,
    urlPath: "/api/v1/custom"
  });

  const second = await app.inject({ method: "GET", url: "/api/v1/custom-with-schema" });
  assert.equal(second.statusCode, 200);

  await app.close();
});

test("registerApiRoutes rejects console routes without workspace metadata", async () => {
  const app = Fastify();

  assert.throws(
    () =>
      registerApiRoutes(app, {
        controllers: noopControllers(),
        routes: [
          {
            path: "/api/console/needs-meta",
            method: "GET",
            handler: async (_request, reply) => {
              reply.code(200).send({ ok: true });
            }
          }
        ]
      }),
    /workspacePolicy and workspaceSurface/
  );

  await app.close();
});
