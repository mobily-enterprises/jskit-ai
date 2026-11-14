import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

const REPORTED_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join("; ");

const pluginProvider = defineProvider({
  id: "fixture.plugin",
  requires: {
    fastify: "runtime.fastify"
  },
  async setup({ fastify }) {
    await fastify.register(async (child) => {
      child.get("/plugin", async () => ({ plugin: true }));
    });
    return {};
  }
});

/**
 * A Fastify server assembled the way an application's server.js assembles it: a health route
 * before the runtime, a plugin a provider registers, a page and a not-found fallback after.
 * @param {import("node:test").TestContext} context
 * @param {{ config?: Record<string, unknown>, env?: Record<string, string> }} options
 */
async function createAppServer(context, { config = {}, env = {} } = {}) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-security-headers-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
  const app = Fastify();
  context.after(() => app.close());
  app.get("/api/health", async () => ({ ok: true }));
  await createInstalledRuntime({ appRoot, config, env, logger: silentLogger, fastify: app, providers: [pluginProvider] });
  app.get("/page", async (request, reply) => reply.type("text/html; charset=utf-8").send("<p>Page</p>"));
  app.get("/hub", async (request, reply) => {
    reply.raw.setHeader("content-security-policy", "frame-ancestors 'none'");
    return reply.type("text/html; charset=utf-8").send("<p>Hub</p>");
  });
  app.get("/own-referrer", async (request, reply) => reply.header("referrer-policy", "no-referrer").send({ own: true }));
  app.get("/broken", async () => {
    throw new Error("Broken.");
  });
  app.setNotFoundHandler(async (request, reply) => reply.code(404).type("text/html; charset=utf-8").send("<p>Shell</p>"));
  return app;
}

const ROUTES = ["/api/health", "/plugin", "/page", "/broken", "/missing"];
const PRODUCTION = Object.freeze({ APP_ENV: "production", NODE_ENV: "production" });

test("development and test responses carry nosniff and a Referrer-Policy, and nothing that stops a preview framing them", async (context) => {
  // NODE_ENV only picks optimised builds: a production build in development is still development.
  for (const env of [{ APP_ENV: "development", NODE_ENV: "production" }, { APP_ENV: "test" }]) {
    const app = await createAppServer(context, { env });
    for (const url of ROUTES) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.headers["x-content-type-options"], "nosniff", url);
      assert.equal(response.headers["referrer-policy"], "strict-origin-when-cross-origin", url);
      assert.equal(response.headers["content-security-policy"], undefined, url);
      assert.equal(response.headers["content-security-policy-report-only"], undefined, url);
      assert.equal(response.headers["strict-transport-security"], undefined, url);
    }
  }
});

test("staging and production responses enforce frame-ancestors, report the content policy and send HSTS", async (context) => {
  for (const env of [{ APP_ENV: "staging", NODE_ENV: "production" }, PRODUCTION]) {
    const app = await createAppServer(context, { env });
    for (const url of ROUTES) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.headers["x-content-type-options"], "nosniff", url);
      assert.equal(response.headers["content-security-policy"], "frame-ancestors 'self'", url);
      assert.equal(response.headers["content-security-policy-report-only"], REPORTED_POLICY, url);
      assert.equal(response.headers["strict-transport-security"], "max-age=31536000", url);
    }
  }
});

test("a route's own security header wins over the default", async (context) => {
  const app = await createAppServer(context, { env: PRODUCTION });
  const hub = await app.inject({ method: "GET", url: "/hub" });
  assert.equal(hub.headers["content-security-policy"], "frame-ancestors 'none'");
  const own = await app.inject({ method: "GET", url: "/own-referrer" });
  assert.equal(own.headers["referrer-policy"], "no-referrer");
});

test("config.securityHeaders allows an editor to frame production, enforces the policy and switches headers off", async (context) => {
  const app = await createAppServer(context, {
    env: PRODUCTION,
    config: {
      securityHeaders: {
        referrerPolicy: "no-referrer",
        strictTransportSecurity: false,
        frameAncestors: ["'self'", "https://editor.example.com"],
        contentSecurityPolicy: {
          mode: "enforce",
          directives: {
            "connect-src": ["'self'", "https://auth.example.com"],
            "form-action": false
          }
        }
      }
    }
  });
  const response = await app.inject({ method: "GET", url: "/page" });
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["strict-transport-security"], undefined);
  assert.equal(response.headers["content-security-policy-report-only"], undefined);
  const policy = response.headers["content-security-policy"];
  assert.match(policy, /(^|; )connect-src 'self' https:\/\/auth\.example\.com(;|$)/u);
  assert.doesNotMatch(policy, /form-action/u);
  assert.match(policy, /; frame-ancestors 'self' https:\/\/editor\.example\.com$/u);
});

test("config.securityHeaders can leave out the content policy, framing and nosniff", async (context) => {
  const app = await createAppServer(context, {
    env: PRODUCTION,
    config: { securityHeaders: { noSniff: false, frameAncestors: false, contentSecurityPolicy: { mode: "off" } } }
  });
  const response = await app.inject({ method: "GET", url: "/page" });
  assert.equal(response.headers["x-content-type-options"], undefined);
  assert.equal(response.headers["content-security-policy"], undefined);
  assert.equal(response.headers["content-security-policy-report-only"], undefined);
  assert.equal(response.headers["strict-transport-security"], "max-age=31536000");
});

test("an invalid config.securityHeaders stops the server from starting", async (context) => {
  for (const [securityHeaders, message] of [
    ["strict", /config\.securityHeaders must be an object/u],
    [{ frameAncestors: "https://editor.example.com" }, /frameAncestors must be a non-empty list/u],
    [{ frameAncestors: ["'self'; script-src *"] }, /frameAncestors must be a non-empty list/u],
    [{ contentSecurityPolicy: { mode: "strict" } }, /mode must be one of: report-only, enforce, off/u],
    [{ contentSecurityPolicy: { directives: { "frame-ancestors": ["*"] } } }, /use frameAncestors for framing/u],
    [{ referrerPolicy: "no-referrer\r\nx-injected: 1" }, /referrerPolicy must be a header value or false/u]
  ]) {
    await assert.rejects(createAppServer(context, { env: PRODUCTION, config: { securityHeaders } }), { message });
  }
});
