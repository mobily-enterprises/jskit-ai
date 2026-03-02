import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel-core/server";
import { createHttpRuntime } from "@jskit-ai/http-fastify-core/kernel";
import { SettingsRouteServiceProvider } from "../src/server/providers/SettingsRouteServiceProvider.js";

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

test("settings route provider registers routes and handles settings read", async () => {
  const fastify = createFastifyStub();
  const app = createApplication();
  const httpRuntime = createHttpRuntime({ app, fastify });

  app.instance("authService", {
    writeSessionCookies() {},
    clearSessionCookies() {}
  });

  app.instance("actionExecutor", {
    async execute({ actionId }) {
      if (actionId === "settings.read") {
        return { profile: { displayName: "Ada" } };
      }
      return {};
    }
  });

  await app.start({ providers: [SettingsRouteServiceProvider] });

  const registration = httpRuntime.registerRoutes();
  assert.equal(registration.routeCount > 0, true);

  const settingsRoute = fastify.routes.find((route) => route.method === "GET" && route.url === "/api/settings");
  assert.ok(settingsRoute);

  const reply = createReplyStub();
  await settingsRoute.handler({}, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, { profile: { displayName: "Ada" } });
});
