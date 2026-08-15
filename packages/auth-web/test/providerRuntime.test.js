import assert from "node:assert/strict";
import test from "node:test";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";
import { AuthFeature } from "@jskit-ai/auth-core/server/providers/AuthFeature";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { AuthWebFeature } from "../src/server/AuthWebFeature.js";

function createFastifyStub() {
  return {
    hooks: [],
    routes: [],
    errorHandler: null,
    addHook(name, handler) {
      this.hooks.push({ name, handler });
    },
    route(definition) {
      this.routes.push(definition);
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
    async generateCsrf() {
      return "csrf-test";
    },
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

function createAuthService(events = []) {
  return {
    async register(input) {
      return {
        actor: { displayName: input.displayName, email: input.email },
        session: { access_token: "register-a", refresh_token: "register-r" },
        requiresEmailConfirmation: false
      };
    },
    async resendRegisterConfirmation() {
      return { ok: true, message: "Confirmation sent." };
    },
    async login() {
      return {
        session: { access_token: "a", refresh_token: "r" },
        actor: { displayName: "Ada", email: "ada@example.com" }
      };
    },
    async devLoginAs(_request, input) {
      return {
        session: { access_token: "dev-a", refresh_token: "dev-r" },
        actor: { id: input.userId || "7", displayName: "Dev Ada", email: "ada@example.com" }
      };
    },
    async logout() {
      return { ok: true, clearSession: true };
    },
    async authenticateRequest() {
      return { authenticated: false };
    },
    getCapabilities() {
      return {
        provider: { id: "local", label: "Local" },
        features: {
          password: { login: true, register: true, change: true, methodToggle: false },
          passwordRecovery: { request: true, complete: true, delivery: "dev-log" },
          otp: { login: false },
          oauthLogin: { enabled: false, providers: [], defaultProvider: null },
          emailConfirmation: false,
          profileUpdate: true,
          providerLinking: { start: false, unlink: false },
          securityStatus: true,
          signOutOtherSessions: true,
          appProfileProjection: false,
          devLoginAs: false
        }
      };
    },
    writeSessionCookies(_reply, session) {
      events.push({ type: "writeSession", session });
    },
    clearSessionCookies() {
      events.push({ type: "clearSession" });
    }
  };
}

async function startAuthWeb({ env = {}, authService = null } = {}) {
  const fastify = createFastifyStub();
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.service": authService || createAuthService(),
      "runtime.env": { NODE_ENV: "test", ...env },
      "runtime.fastify": fastify
    },
    providers: [createActionProvider(), HttpProvider, AuthFeature, AuthWebFeature]
  });
  await runtime.start();
  return { fastify, runtime };
}

test("AuthWebFeature registers direct action-backed login and logout routes", async () => {
  const events = [];
  const { fastify } = await startAuthWeb({ authService: createAuthService(events) });
  const loginRoute = fastify.routes.find((route) => route.method === "POST" && route.url === "/api/login");
  const loginReply = createReplyStub();
  await loginRoute.handler({ body: { email: "ada@example.com", password: "password value" } }, loginReply);
  assert.equal(loginReply.statusCode, 200);
  assert.equal(loginReply.payload.username, "Ada");

  const logoutRoute = fastify.routes.find((route) => route.method === "POST" && route.url === "/api/logout");
  const logoutReply = createReplyStub();
  await logoutRoute.handler({}, logoutReply);
  assert.deepEqual(logoutReply.payload, { ok: true });
  assert.equal(events.some((entry) => entry.type === "writeSession"), true);
  assert.equal(events.some((entry) => entry.type === "clearSession"), true);
});

test("AuthWebFeature exposes dev login only when the explicit dev policy enables it", async () => {
  const disabled = await startAuthWeb();
  assert.equal(disabled.fastify.routes.some((route) => route.url === "/api/dev-auth/login-as"), false);
  const enabled = await startAuthWeb({
    env: {
      NODE_ENV: "development",
      AUTH_DEV_BYPASS_ENABLED: "true",
      AUTH_DEV_BYPASS_SECRET: "test-secret"
    }
  });
  assert.equal(enabled.fastify.routes.some((route) => route.url === "/api/dev-auth/login-as"), true);
});

test("auth session route returns provider capabilities", async () => {
  const { fastify } = await startAuthWeb();
  const sessionRoute = fastify.routes.find((route) => route.method === "GET" && route.url === "/api/session");
  const reply = createReplyStub();
  await sessionRoute.handler({}, reply);
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.authenticated, false);
  assert.equal(reply.payload.authCapabilities.provider.id, "local");
  assert.equal(reply.payload.authCapabilities.features.password.register, true);
});
