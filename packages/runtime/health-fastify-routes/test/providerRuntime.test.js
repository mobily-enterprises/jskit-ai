import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel-core";
import { createHttpRuntime } from "@jskit-ai/http-fastify-core/kernel";
import { TOKENS } from "@jskit-ai/support-core/tokens";
import { HealthRouteServiceProvider } from "../src/server/providers/HealthRouteServiceProvider.js";

function createFastifyStub() {
  const routes = [];
  return {
    routes,
    route(definition) {
      routes.push(definition);
    }
  };
}

function createReplyStub() {
  return {
    sent: false,
    statusCode: null,
    payload: null,
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      this.sent = true;
      return this;
    }
  };
}

test("health provider registers routes through new router/runtime path", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();
  const httpRuntime = createHttpRuntime({ app, fastify });

  app.instance(TOKENS.HealthService, {
    async health() {
      return { ok: true, mode: "custom" };
    },
    async readiness() {
      return { ok: false, checks: { db: "down" } };
    }
  });

  await app.start({
    providers: [HealthRouteServiceProvider]
  });

  const registration = httpRuntime.registerRoutes();
  assert.equal(registration.routeCount, 2);
  assert.equal(fastify.routes.length, 2);

  const healthReply = createReplyStub();
  await fastify.routes[0].handler({}, healthReply);
  assert.equal(healthReply.statusCode, 200);
  assert.equal(healthReply.payload.mode, "custom");

  const readinessReply = createReplyStub();
  await fastify.routes[1].handler({}, readinessReply);
  assert.equal(readinessReply.statusCode, 503);
  assert.equal(readinessReply.payload.ok, false);
});
