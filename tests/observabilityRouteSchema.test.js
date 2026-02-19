import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";
import { buildRoutes as buildObservabilityRoutes } from "../server/modules/observability/routes.js";
import { createController as createObservabilityController } from "../server/modules/observability/controller.js";
import { createService as createObservabilityService } from "../server/modules/observability/service.js";
import { createMetricsRegistry } from "../server/lib/observability/metrics.js";

function installErrorHandler(app) {
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = Number(error?.statusCode || error?.status || 500);
    reply.code(statusCode).send({
      error: String(error?.message || "Request failed."),
      statusCode
    });
  });
}

function buildApp({ metricsEnabled = true, metricsBearerToken = "" } = {}) {
  const app = Fastify();
  installErrorHandler(app);

  const metricsRegistry = createMetricsRegistry({
    httpDurationBuckets: [0.1, 0.5, 1]
  });
  metricsRegistry.observeHttpRequest({
    method: "GET",
    route: "/api/demo",
    surface: "app",
    statusCode: 200,
    durationMs: 12
  });

  const observabilityService = createObservabilityService({
    metricsRegistry,
    metricsEnabled,
    metricsBearerToken
  });
  const controllers = {
    observability: createObservabilityController({
      observabilityService
    })
  };

  registerApiRoutes(app, {
    controllers,
    routes: buildObservabilityRoutes(controllers)
  });

  return app;
}

test("observability route serves Prometheus metrics text", async () => {
  const app = buildApp();

  const response = await app.inject({
    method: "GET",
    url: "/api/metrics"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"].includes("text/plain"), true);
  assert.match(response.payload, /app_http_requests_total/);

  await app.close();
});

test("observability route enforces bearer token and disabled behavior", async () => {
  const protectedApp = buildApp({
    metricsEnabled: true,
    metricsBearerToken: "top-secret"
  });

  const unauthorized = await protectedApp.inject({
    method: "GET",
    url: "/api/metrics"
  });
  assert.equal(unauthorized.statusCode, 401);

  const authorized = await protectedApp.inject({
    method: "GET",
    url: "/api/metrics",
    headers: {
      authorization: "Bearer top-secret"
    }
  });
  assert.equal(authorized.statusCode, 200);
  await protectedApp.close();

  const disabledApp = buildApp({ metricsEnabled: false });
  const disabled = await disabledApp.inject({
    method: "GET",
    url: "/api/metrics"
  });
  assert.equal(disabled.statusCode, 404);
  await disabledApp.close();
});
