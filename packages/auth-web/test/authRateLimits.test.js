import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { AppError, EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime } from "@jskit-ai/kernel/shared/capabilities";
import { AuthFeature } from "@jskit-ai/auth-core/server/providers/AuthFeature";
import { AuthWebFeature } from "../src/server/AuthWebFeature.js";
import { DEFAULT_AUTH_RATE_LIMITS, resolveAuthRateLimits } from "../src/server/authRateLimits.js";

/** An auth service whose every sign-in is a wrong password. */
function createRefusingAuthService() {
  return {
    async login() {
      throw new AppError(401, "Invalid email or password.", { code: "auth.login.invalidCredentials" });
    },
    async authenticateRequest() {
      return { authenticated: false };
    },
    getCapabilities() {
      return { provider: { id: "local", label: "Local" }, features: {} };
    },
    writeSessionCookies() {},
    clearSessionCookies() {}
  };
}

async function startAuthWeb(t, config = {}) {
  const app = Fastify();
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.service": createRefusingAuthService(),
      "runtime.config": config,
      "runtime.env": { APP_ENV: "test" },
      "runtime.fastify": app,
      "runtime.logger": silentLogger
    },
    providers: [EventProvider, ActionProvider, HttpProvider, AuthFeature, AuthWebFeature]
  });
  await runtime.start();
  t.after(async () => {
    await runtime.shutdown();
    await app.close();
  });
  return app;
}

async function signInAttempts(app, count, remoteAddress = "203.0.113.7") {
  const statuses = [];
  let lastResponse = null;
  for (let attempt = 0; attempt < count; attempt += 1) {
    lastResponse = await app.inject({
      method: "POST",
      url: "/api/login",
      remoteAddress,
      payload: { email: "ada@example.com", password: `guess number ${attempt}` }
    });
    statuses.push(lastResponse.statusCode);
  }
  return { statuses, lastResponse };
}

test("25 rapid wrong-password sign-ins from one address are refused after the login limit", async (t) => {
  const app = await startAuthWeb(t);
  const { statuses, lastResponse } = await signInAttempts(app, 25);

  const allowed = DEFAULT_AUTH_RATE_LIMITS.login.max;
  assert.deepEqual(statuses.slice(0, allowed), Array(allowed).fill(401));
  assert.deepEqual(statuses.slice(allowed), Array(25 - allowed).fill(429));
  assert.equal(lastResponse.json().code, "kernel.http.rateLimited");
  assert.ok(Number(lastResponse.headers["retry-after"]) > 0);
});

test("config.auth.rateLimits changes a route's limit, and false removes it", async (t) => {
  const tighter = await startAuthWeb(t, { auth: { rateLimits: { login: { max: 3 } } } });
  assert.deepEqual((await signInAttempts(tighter, 5)).statuses, [401, 401, 401, 429, 429]);

  const unlimited = await startAuthWeb(t, { auth: { rateLimits: { login: false } } });
  assert.deepEqual((await signInAttempts(unlimited, 15)).statuses, Array(15).fill(401));
});

test("a misspelt or malformed rate limit override stops startup", () => {
  assert.throws(() => resolveAuthRateLimits({ auth: { rateLimits: { signIn: { max: 3 } } } }),
    /config\.auth\.rateLimits\.signIn names no auth route/u);
  assert.throws(() => resolveAuthRateLimits({ auth: { rateLimits: { login: 3 } } }),
    /config\.auth\.rateLimits\.login must be \{ max, timeWindow \} or false/u);
  assert.throws(() => resolveAuthRateLimits({ auth: { rateLimits: [] } }),
    /config\.auth\.rateLimits must be an object/u);
  assert.equal(resolveAuthRateLimits({}).login, DEFAULT_AUTH_RATE_LIMITS.login);
});
