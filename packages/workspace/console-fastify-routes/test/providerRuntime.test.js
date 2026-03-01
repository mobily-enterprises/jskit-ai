import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel-core";
import { createHttpRuntime } from "@jskit-ai/http-fastify-core/kernel";
import { ConsoleRouteServiceProvider } from "../src/server/providers/ConsoleRouteServiceProvider.js";

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

test("console route provider registers routes and handles listRoles", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();
  const httpRuntime = createHttpRuntime({ app, fastify });

  app.instance("actionExecutor", {
    async execute({ actionId }) {
      if (actionId === "console.roles.list") {
        return {
          roles: [{ id: "owner", label: "Owner" }]
        };
      }
      return {};
    }
  });

  await app.start({ providers: [ConsoleRouteServiceProvider] });

  const registration = httpRuntime.registerRoutes();
  assert.equal(registration.routeCount > 0, true);

  const rolesRoute = fastify.routes.find((route) => route.method === "GET" && route.url === "/api/console/roles");
  assert.ok(rolesRoute);

  const reply = createReplyStub();
  await rolesRoute.handler({}, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    roles: [{ id: "owner", label: "Owner" }]
  });
});
