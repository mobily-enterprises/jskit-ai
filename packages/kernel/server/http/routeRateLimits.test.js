import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import english from "../../locales/en.json" with { type: "json" };
import { catalogMessage, formatMessage, messageKeyForCode } from "../../shared/i18n/index.js";
import { ActionProvider } from "../actions/actionProvider.js";
import { EventProvider } from "../runtime/EventProvider.js";
import { silentLogger } from "../runtime/logger.js";
import { createCapabilityRuntime } from "../../shared/capabilities/runtime.js";
import { defineFeature } from "../features/defineFeature.js";
import { HttpProvider } from "./HttpProvider.js";
import { createRouter } from "./lib/router.js";
import { resolveTrustedProxies } from "./trustedProxies.js";
import { resolveClientIpAddress } from "../runtime/requestUrl.js";

/**
 * A started runtime whose feature registers each route through runtime.http, as
 * every JSKIT package does, on a real Fastify instance.
 */
async function startRoutes(t, register, fastifyOptions = {}) {
  const app = Fastify(fastifyOptions);
  const feature = defineFeature({
    id: "feature.rate-limit-proof",
    domain: "rate-limit-proof",
    requires: { http: "runtime.http" },
    setup({ http }) {
      register(http.router);
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger, "runtime.fastify": app },
    providers: [EventProvider, ActionProvider, HttpProvider, feature]
  });
  await runtime.start();
  t.after(async () => {
    await runtime.shutdown();
    await app.close();
  });
  return app;
}

test("a route's declared rateLimit refuses the requests over it with a coded 429 and Retry-After", async (t) => {
  const app = await startRoutes(t, (router) => {
    router.post("/api/limited", { rateLimit: { max: 2, timeWindow: "1 minute" } }, async () => ({ ok: true }));
    router.post("/api/unlimited", {}, async () => ({ ok: true }));
  });

  assert.equal((await app.inject({ method: "POST", url: "/api/limited" })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/limited" })).statusCode, 200);
  const refused = await app.inject({ method: "POST", url: "/api/limited" });
  assert.equal(refused.statusCode, 429);
  const retryAfter = Number(refused.headers["retry-after"]);
  assert.ok(retryAfter > 0 && retryAfter <= 60, `Retry-After ${refused.headers["retry-after"]}`);
  const payload = refused.json();
  assert.equal(payload.code, "kernel.http.rateLimited");
  assert.equal(payload.params.count, retryAfter);
  const template = catalogMessage(english, messageKeyForCode(payload.code));
  assert.equal(formatMessage(template, payload.params), payload.error);

  // Each route counts on its own, and a route without a limit has none.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await app.inject({ method: "POST", url: "/api/unlimited" })).statusCode, 200);
  }
});

test("each client address has its own count", async (t) => {
  const app = await startRoutes(t, (router) => {
    router.post("/api/limited", { rateLimit: { max: 1, timeWindow: 60_000 } }, async () => ({ ok: true }));
  });

  assert.equal((await app.inject({ method: "POST", url: "/api/limited", remoteAddress: "10.0.0.1" })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/limited", remoteAddress: "10.0.0.1" })).statusCode, 429);
  assert.equal((await app.inject({ method: "POST", url: "/api/limited", remoteAddress: "10.0.0.2" })).statusCode, 200);
});

// A server created with trustProxy: resolveTrustedProxies(env) counts each client behind the proxies TRUSTED_PROXIES
// names, and a client's own X-Forwarded-For changes neither its address nor its count.
test("behind a named proxy each client has its own count, and a client forging X-Forwarded-For stays limited", async (t) => {
  const app = await startRoutes(t, (router) => {
    router.post("/api/limited", { rateLimit: { max: 1, timeWindow: 60_000 } }, async (request, reply) => {
      reply.header("x-seen-ip", request.ip).header("x-seen-client", resolveClientIpAddress(request));
      return { ok: true };
    });
  }, { trustProxy: resolveTrustedProxies({ TRUSTED_PROXIES: "10.0.0.5" }) });
  // The address the server saw, and the one resolveClientIpAddress records.
  const seen = (response) => ({ ip: response.headers["x-seen-ip"], client: response.headers["x-seen-client"] });
  const send = (remoteAddress, forwardedFor) => app.inject({
    method: "POST",
    url: "/api/limited",
    remoteAddress,
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {}
  });

  const direct = await send("203.0.113.9", "198.51.100.1");
  assert.equal(direct.statusCode, 200);
  assert.deepEqual(seen(direct), { ip: "203.0.113.9", client: "203.0.113.9" });
  assert.equal((await send("203.0.113.9", "198.51.100.2")).statusCode, 429, "a new forged address is still the same client");

  const proxied = await send("10.0.0.5", "198.51.100.7");
  assert.equal(proxied.statusCode, 200);
  assert.deepEqual(seen(proxied), { ip: "198.51.100.7", client: "198.51.100.7" });
  const other = await send("10.0.0.5", "198.51.100.8");
  assert.equal(other.statusCode, 200, "another client behind the proxy has its own count");
  assert.equal(seen(other).ip, "198.51.100.8");
  assert.equal((await send("10.0.0.5", "198.51.100.7")).statusCode, 429);
  // A client that prepends an address before the proxy adds its own is still the address the proxy saw.
  const prepended = await send("10.0.0.5", "192.0.2.50, 198.51.100.9");
  assert.equal(seen(prepended).ip, "198.51.100.9");
});

test("without TRUSTED_PROXIES only a proxy on the same machine is believed", async (t) => {
  const app = await startRoutes(t, (router) => {
    router.get("/api/address", {}, async (request, reply) => {
      reply.header("x-seen-ip", request.ip);
      return { ok: true };
    });
  }, { trustProxy: resolveTrustedProxies({}) });
  const addressOf = async (remoteAddress) => (await app.inject({
    method: "GET",
    url: "/api/address",
    remoteAddress,
    headers: { "x-forwarded-for": "198.51.100.20" }
  })).headers["x-seen-ip"];

  assert.equal(await addressOf("127.0.0.1"), "198.51.100.20");
  assert.equal(await addressOf("::1"), "198.51.100.20");
  assert.equal(await addressOf("10.0.0.5"), "10.0.0.5");
  assert.equal(await addressOf("203.0.113.9"), "203.0.113.9");
});

test("a malformed rateLimit, or one hidden in config, stops the route's definition", () => {
  const router = createRouter();
  const handler = async () => ({});
  assert.throws(() => router.post("/a", { rateLimit: { max: 0, timeWindow: "1 minute" } }, handler),
    /rateLimit\.max must be a positive integer/u);
  assert.throws(() => router.post("/b", { rateLimit: { max: 3, timeWindow: "soon" } }, handler),
    /rateLimit\.timeWindow must be milliseconds/u);
  assert.throws(() => router.post("/c", { rateLimit: { max: 3, timeWindow: "1 minute", ban: 2 } }, handler),
    /rateLimit must be \{ max, timeWindow \}/u);
  assert.throws(() => router.post("/d", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, handler),
    /declare rateLimit on the route instead/u);
  assert.equal(router.list().length, 0);
});
