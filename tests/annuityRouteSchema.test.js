import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerApiRoutes } from "../routes/apiRoutes.js";

function buildStubControllers() {
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

test("annuity route schema accepts perpetual payload when years is 0", async () => {
  const app = Fastify();
  registerApiRoutes(app, { controllers: buildStubControllers() });

  const response = await app.inject({
    method: "POST",
    url: "/api/annuity",
    payload: {
      mode: "pv",
      timing: "ordinary",
      payment: 500,
      annualRate: 6,
      annualGrowthRate: 0,
      years: 0,
      paymentsPerYear: 12,
      isPerpetual: true
    }
  });

  assert.equal(response.statusCode, 200);
  await app.close();
});

test("annuity route does not crash on malformed host header", async () => {
  const app = Fastify();
  registerApiRoutes(app, { controllers: buildStubControllers() });

  const response = await app.inject({
    method: "POST",
    url: "/api/annuity",
    headers: {
      host: "%zz"
    },
    payload: {
      mode: "pv",
      timing: "ordinary",
      payment: 500,
      annualRate: 6,
      annualGrowthRate: 0,
      paymentsPerYear: 12,
      isPerpetual: true
    }
  });

  assert.equal(response.statusCode, 200);
  await app.close();
});
