import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { resolveTrustedProxies } from "@jskit-ai/kernel/server/http";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

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

const PRODUCTION = Object.freeze({
  APP_ENV: "production",
  NODE_ENV: "production",
  APP_PUBLIC_URL: "https://example.com",
  APP_REDIRECT_HOSTS: "www.example.com, Old.Example.org"
});

/**
 * A Fastify server assembled the way an application's server.js assembles it: a health route before the runtime, a
 * plugin a provider registers, a page and a not-found fallback after.
 * @param {import("node:test").TestContext} context
 * @param {{ env?: Record<string, string>, fastify?: import("fastify").FastifyInstance }} options
 */
async function createAppServer(context, { env = PRODUCTION, fastify = Fastify() } = {}) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-redirect-hosts-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
  context.after(() => fastify.close());
  fastify.get("/api/health", async () => ({ ok: true }));
  fastify.post("/api/things", async () => ({ made: true }));
  await createInstalledRuntime({ appRoot, env, logger: silentLogger, fastify, providers: [pluginProvider] });
  fastify.get("/page", async (request, reply) => reply.type("text/html; charset=utf-8").send("<p>Page</p>"));
  fastify.setNotFoundHandler(async (request, reply) => reply.code(404).type("text/html; charset=utf-8").send("<p>Shell</p>"));
  return fastify;
}

test("a request sent to one of APP_REDIRECT_HOSTS's names is sent on with a 301 to the same path and query at APP_PUBLIC_URL", async (context) => {
  const app = await createAppServer(context);
  const cases = [
    ["www.example.com", "GET", "/plugin?x=1&y=two", "https://example.com/plugin?x=1&y=two"],
    ["www.example.com", "GET", "/", "https://example.com/"],
    ["WWW.Example.COM", "GET", "/page", "https://example.com/page"],
    ["www.example.com:443", "GET", "/api/health", "https://example.com/api/health"],
    ["old.example.org", "GET", "/missing/deep?q=1", "https://example.com/missing/deep?q=1"],
    ["www.example.com", "POST", "/api/things", "https://example.com/api/things"],
    ["www.example.com", "HEAD", "/page", "https://example.com/page"],
    // A path that reads like a host stays a path on APP_PUBLIC_URL's own host: never an address elsewhere.
    ["www.example.com", "GET", "//elsewhere.example/x", "https://example.com//elsewhere.example/x"]
  ];
  for (const [host, method, url, location] of cases) {
    const response = await app.inject({ method, url, headers: { host } });
    assert.equal(response.statusCode, 301, `${method} ${host}${url}`);
    assert.equal(response.headers.location, location, `${method} ${host}${url}`);
    // Every other hook still runs: the redirect carries the security headers every answer carries.
    assert.equal(response.headers["x-content-type-options"], "nosniff", `${method} ${host}${url}`);
  }
});

test("a request sent to APP_PUBLIC_URL's own name, or to any name APP_REDIRECT_HOSTS doesn't list, is served as before", async (context) => {
  const app = await createAppServer(context);
  // The main name; an instance's own name or address, as a load balancer's health check sends it; a name nobody listed.
  for (const host of ["example.com", "svc-7f3k.internal", "10.0.4.17:3000", "shop.example.com"]) {
    assert.deepEqual((await app.inject({ method: "GET", url: "/plugin", headers: { host } })).json(), { plugin: true }, host);
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/health", headers: { host } })).json(), { ok: true }, host);
    assert.equal((await app.inject({ method: "GET", url: "/missing", headers: { host } })).statusCode, 404, host);
  }
});

test("only a proxy TRUSTED_PROXIES names may say the name in X-Forwarded-Host; a client's own header changes nothing", async (context) => {
  const untrusted = await createAppServer(context);
  const fromClient = await untrusted.inject({ method: "GET", url: "/plugin", headers: { host: "example.com", "x-forwarded-host": "www.example.com" } });
  assert.equal(fromClient.statusCode, 200);

  const env = { ...PRODUCTION, TRUSTED_PROXIES: "loopback" };
  const behindProxy = await createAppServer(context, { env, fastify: Fastify({ trustProxy: resolveTrustedProxies(env) }) });
  const fromProxy = await behindProxy.inject({
    method: "GET",
    url: "/plugin",
    remoteAddress: "127.0.0.1",
    headers: { host: "10.0.4.17:3000", "x-forwarded-host": "www.example.com" }
  });
  assert.equal(fromProxy.statusCode, 301);
  assert.equal(fromProxy.headers.location, "https://example.com/plugin");
});

test("without APP_REDIRECT_HOSTS, or with it empty, every name is served as before, in every environment", async (context) => {
  const environments = [
    { APP_ENV: "development", APP_PUBLIC_URL: "http://localhost:3000" },
    { APP_ENV: "production", NODE_ENV: "production", APP_PUBLIC_URL: "https://example.com", APP_REDIRECT_HOSTS: "  " },
    { APP_ENV: "staging", NODE_ENV: "production" }
  ];
  for (const env of environments) {
    const app = await createAppServer(context, { env });
    const response = await app.inject({ method: "GET", url: "/plugin", headers: { host: "www.example.com" } });
    assert.equal(response.statusCode, 200, JSON.stringify(env));
  }
});

test("APP_REDIRECT_HOSTS works in development too, sending to APP_PUBLIC_URL's own scheme and port", async (context) => {
  const env = { APP_ENV: "development", APP_PUBLIC_URL: "http://localhost:3000/", APP_REDIRECT_HOSTS: "127.0.0.1" };
  const app = await createAppServer(context, { env });
  const response = await app.inject({ method: "GET", url: "/page?a=1", headers: { host: "127.0.0.1:3000" } });
  assert.equal(response.statusCode, 301);
  assert.equal(response.headers.location, "http://localhost:3000/page?a=1");
});

test("a server refuses to start with APP_REDIRECT_HOSTS it cannot follow, naming the fix", async (context) => {
  const refusals = [
    [{ APP_PUBLIC_URL: undefined }, /APP_REDIRECT_HOSTS sends its names to APP_PUBLIC_URL, which is not set/u],
    [{ APP_PUBLIC_URL: "example.com" }, /APP_PUBLIC_URL is "example\.com", which is not an http or https address/u],
    [{ APP_PUBLIC_URL: "ftp://example.com" }, /APP_PUBLIC_URL is "ftp:\/\/example\.com", which is not an http or https address/u],
    [{ APP_REDIRECT_HOSTS: "https://www.example.com" }, /APP_REDIRECT_HOSTS has "https:\/\/www\.example\.com", which is not a host name/u],
    [{ APP_REDIRECT_HOSTS: "www.example.com/shop" }, /APP_REDIRECT_HOSTS has "www\.example\.com\/shop", which is not a host name/u],
    [{ APP_REDIRECT_HOSTS: "www.example.com:8443" }, /APP_REDIRECT_HOSTS has "www\.example\.com:8443", which is not a host name/u],
    [{ APP_REDIRECT_HOSTS: "*.example.com" }, /APP_REDIRECT_HOSTS has "\*\.example\.com", which is not a host name/u],
    [{ APP_REDIRECT_HOSTS: "www.example.com,Example.com" }, /APP_REDIRECT_HOSTS has example\.com, APP_PUBLIC_URL's own name/u]
  ];
  for (const [change, message] of refusals) {
    const env = { ...PRODUCTION, ...change };
    for (const [name, value] of Object.entries(change)) if (value === undefined) delete env[name];
    const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-redirect-hosts-"));
    context.after(() => rm(appRoot, { recursive: true, force: true }));
    await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
    const fastify = Fastify();
    context.after(() => fastify.close());
    await assert.rejects(
      createInstalledRuntime({ appRoot, env, logger: silentLogger, fastify }),
      (error) => error instanceof TypeError && message.test(error.message),
      JSON.stringify(change)
    );
  }
});
