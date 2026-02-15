import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerApiRoutes } from "../routes/apiRoutes.js";

function buildStubControllers({ onHistoryList } = {}) {
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
        reply.code(200).send({ authenticated: true, username: "demo-user", csrfToken: "test-csrf-token" });
      }
    },
    history: {
      async list(request, reply) {
        if (typeof onHistoryList === "function") {
          await onHistoryList(request);
        }
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
        });
      }
    }
  };
}

test("history route accepts query strings for page and pageSize", async () => {
  let capturedQuery = null;
  const app = Fastify();
  registerApiRoutes(app, {
    controllers: buildStubControllers({
      onHistoryList(request) {
        capturedQuery = request.query;
      }
    })
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/history?page=1&pageSize=10"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(capturedQuery.page, 1);
  assert.equal(capturedQuery.pageSize, 10);
  await app.close();
});

test("history route rejects out-of-range pageSize", async () => {
  const app = Fastify();
  registerApiRoutes(app, { controllers: buildStubControllers() });

  const response = await app.inject({
    method: "GET",
    url: "/api/history?page=1&pageSize=101"
  });

  assert.equal(response.statusCode, 400);
  await app.close();
});
