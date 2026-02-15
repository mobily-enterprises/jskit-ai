import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerApiRoutes } from "../routes/apiRoutes.js";

function noopControllers() {
  return {
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
    history: {
      async list(_request, reply) {
        reply.code(200).send({ entries: [], page: 1, pageSize: 10, total: 0, totalPages: 1 });
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

test("registerApiRoutes supports custom routes and route defaults", async () => {
  const app = Fastify();
  let capturedMeta = null;

  registerApiRoutes(app, {
    controllers: noopControllers(),
    routes: [
      {
        path: "/api/custom",
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
        path: "/api/custom-with-schema",
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

  const first = await app.inject({ method: "GET", url: "/api/custom" });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(capturedMeta, {
    authPolicy: "public",
    ownerParam: null,
    userField: "id",
    ownerResolverType: "object",
    csrfProtection: true,
    urlPath: "/api/custom"
  });

  const second = await app.inject({ method: "GET", url: "/api/custom-with-schema" });
  assert.equal(second.statusCode, 200);

  await app.close();
});
