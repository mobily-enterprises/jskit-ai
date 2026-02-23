import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";
import { buildRoutes as buildHealthRoutes } from "../server/modules/health/routes.js";

function buildControllers({ readinessOk = true } = {}) {
  return {
    health: {
      async getHealth(_request, reply) {
        reply.code(200).send({
          ok: true,
          status: "ok",
          timestamp: "2026-02-19T00:00:00.000Z",
          uptimeSeconds: 1
        });
      },
      async getReadiness(_request, reply) {
        reply.code(readinessOk ? 200 : 503).send({
          ok: readinessOk,
          status: readinessOk ? "ok" : "degraded",
          timestamp: "2026-02-19T00:00:00.000Z",
          uptimeSeconds: 1,
          dependencies: {
            database: readinessOk ? "up" : "down"
          }
        });
      }
    }
  };
}

test("health routes expose liveness and readiness endpoints", async () => {
  const app = Fastify();
  const controllers = buildControllers();
  registerApiRoutes(app, {
    controllers,
    routes: buildHealthRoutes(controllers)
  });

  const healthResponse = await app.inject({
    method: "GET",
    url: "/api/health"
  });
  assert.equal(healthResponse.statusCode, 200);

  const readinessResponse = await app.inject({
    method: "GET",
    url: "/api/ready"
  });
  assert.equal(readinessResponse.statusCode, 200);

  await app.close();
});

test("readiness route supports 503 degraded payload", async () => {
  const app = Fastify();
  const controllers = buildControllers({ readinessOk: false });
  registerApiRoutes(app, {
    controllers,
    routes: buildHealthRoutes(controllers)
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/ready"
  });

  assert.equal(response.statusCode, 503);
  const payload = response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.dependencies.database, "down");

  await app.close();
});
