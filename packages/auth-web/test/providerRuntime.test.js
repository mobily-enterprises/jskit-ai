import assert from "node:assert/strict";
import test from "node:test";
import { createApplication, createHttpRuntime } from "@jskit-ai/kernel/_testable";
import { AuthRouteServiceProvider } from "../src/server/providers/AuthRouteServiceProvider.js";
import { AuthWebServiceProvider } from "../src/server/providers/AuthWebServiceProvider.js";

function createFastifyStub() {
  const routes = [];
  return {
    routes,
    errorHandler: null,
    route(definition) {
      routes.push(definition);
    },
    setErrorHandler(handler) {
      this.errorHandler = handler;
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
      if (actionId === "auth.register.confirmation.resend") {
        return {
          ok: true,
          message: "If an account exists for that email, a confirmation email has been sent."
        };
      }
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
    static id = "auth.provider";
  }

  await app.start({ providers: [MockAuthProvider, AuthWebServiceProvider, AuthRouteServiceProvider] });

  const registration = httpRuntime.registerRoutes();
  assert.equal(registration.routeCount > 0, true);

  const loginRoute = fastify.routes.find((route) => route.method === "POST" && route.url === "/api/login");
  assert.ok(loginRoute);
  const loginReply = createReplyStub();
  await loginRoute.handler({ body: { email: "ada@example.com", password: "pass" } }, loginReply);
  assert.equal(loginReply.statusCode, 200);
  assert.equal(loginReply.payload.username, "Ada");

  const resendConfirmationRoute = fastify.routes.find(
    (route) => route.method === "POST" && route.url === "/api/register/confirmation/resend"
  );
  assert.ok(resendConfirmationRoute);
  const resendConfirmationReply = createReplyStub();
  await resendConfirmationRoute.handler({ body: { email: "ada@example.com" } }, resendConfirmationReply);
  assert.equal(resendConfirmationReply.statusCode, 200);
  assert.equal(resendConfirmationReply.payload.ok, true);

  const logoutRoute = fastify.routes.find((route) => route.method === "POST" && route.url === "/api/logout");
  assert.ok(logoutRoute);
  const logoutReply = createReplyStub();
  await logoutRoute.handler({}, logoutReply);
  assert.equal(logoutReply.statusCode, 200);
  assert.equal(logoutReply.payload.ok, true);

  assert.equal(events.some((entry) => entry.type === "writeSession"), true);
  assert.equal(events.some((entry) => entry.type === "clearSession"), true);
});
