import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel-core";
import { TOKENS } from "@jskit-ai/support-core/tokens";
import { createHttpRuntime, registerRoutes } from "../src/lib/kernel.js";

function createFastifyStub() {
  const routes = [];
  return {
    routes,
    route(definition) {
      routes.push(definition);
    }
  };
}

test("registerRoutes applies middleware then handler", async () => {
  const events = [];
  const fastify = createFastifyStub();

  registerRoutes(fastify, {
    routes: [
      {
        method: "GET",
        path: "/api/ping",
        middleware: [
          async () => events.push("mw1"),
          async () => events.push("mw2")
        ],
        handler: async () => events.push("handler")
      }
    ]
  });

  assert.equal(fastify.routes.length, 1);
  await fastify.routes[0].handler({ id: "req-1" }, { sent: false });
  assert.deepEqual(events, ["mw1", "mw2", "handler"]);
});

test("createHttpRuntime wires router token and registers collected routes", () => {
  const app = createApplication();
  const fastify = createFastifyStub();

  const runtime = createHttpRuntime({ app, fastify });
  const router = app.make(TOKENS.HttpRouter);
  router.get("/api/health", async () => {});

  const result = runtime.registerRoutes();
  assert.equal(result.routeCount, 1);
  assert.equal(fastify.routes.length, 1);
  assert.equal(fastify.routes[0].url, "/api/health");
});
