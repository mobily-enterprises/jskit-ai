import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel-core/server";
import { createHttpRuntime } from "@jskit-ai/http-fastify-core/kernel";
import { ConsoleErrorsRouteServiceProvider } from "../src/server/providers/ConsoleErrorsRouteServiceProvider.js";

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

test("console errors route provider registers routes and handles listBrowserErrors", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();
  const httpRuntime = createHttpRuntime({ app, fastify });

  app.instance("actionExecutor", {
    async execute({ actionId }) {
      if (actionId === "console.errors.browser.list") {
        return { items: [{ id: 1, message: "boom" }] };
      }
      return {};
    }
  });

  await app.start({ providers: [ConsoleErrorsRouteServiceProvider] });

  const registration = httpRuntime.registerRoutes();
  assert.equal(registration.routeCount > 0, true);

  const browserRoute = fastify.routes.find(
    (route) => route.method === "GET" && route.url === "/api/console/errors/browser"
  );
  assert.ok(browserRoute);

  const reply = createReplyStub();
  await browserRoute.handler({ query: {} }, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, { items: [{ id: 1, message: "boom" }] });
});
