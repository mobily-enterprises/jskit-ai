import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "@jskit-ai/kernel-core";
import { createHttpRuntime } from "@jskit-ai/http-fastify-core/kernel";
import { AuthRouteServiceProvider } from "../src/server/providers/AuthRouteServiceProvider.js";

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

test("auth route provider registers routes and executes login/logout handlers", async () => {
  const events = [];
  const fastify = createFastifyStub();
  const app = createApplication();
  const httpRuntime = createHttpRuntime({ app, fastify });

  const authService = {
    writeSessionCookies(_reply, session) {
      events.push({ type: "writeSession", session });
    },
    clearSessionCookies() {
      events.push({ type: "clearSession" });
    },
    getOAuthProviderCatalog() {
      return { providers: [], defaultProvider: "" };
    }
  };

  app.instance("authService", authService);
  app.instance("actionExecutor", {
    async execute({ actionId }) {
      if (actionId === "auth.login.password") {
        return {
          session: { access_token: "a", refresh_token: "r" },
          profile: { displayName: "Ada" }
        };
      }
      if (actionId === "auth.logout") {
        return {
          ok: true,
          clearSession: true
        };
      }
      return {};
    }
  });

  class MockAuthProvider {
    static id = "auth.provider.supabase";
  }

  await app.start({ providers: [MockAuthProvider, AuthRouteServiceProvider] });

  const registration = httpRuntime.registerRoutes();
  assert.equal(registration.routeCount > 0, true);

  const loginRoute = fastify.routes.find((route) => route.method === "POST" && route.url === "/api/login");
  assert.ok(loginRoute);
  const loginReply = createReplyStub();
  await loginRoute.handler({ body: { email: "ada@example.com", password: "pass" } }, loginReply);
  assert.equal(loginReply.statusCode, 200);
  assert.equal(loginReply.payload.username, "Ada");

  const logoutRoute = fastify.routes.find((route) => route.method === "POST" && route.url === "/api/logout");
  assert.ok(logoutRoute);
  const logoutReply = createReplyStub();
  await logoutRoute.handler({}, logoutReply);
  assert.equal(logoutReply.statusCode, 200);
  assert.equal(logoutReply.payload.ok, true);

  assert.equal(events.some((entry) => entry.type === "writeSession"), true);
  assert.equal(events.some((entry) => entry.type === "clearSession"), true);
});
