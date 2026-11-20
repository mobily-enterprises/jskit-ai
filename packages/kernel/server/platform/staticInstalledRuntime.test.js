import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import * as platform from "@jskit-ai/kernel/server/platform";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

const { createInstalledRuntime, createStaticInstalledRuntime } = platform;
const PRODUCTION = Object.freeze({ APP_ENV: "production", NODE_ENV: "production" });
const SECURITY_HEADERS = Object.freeze([
  "x-content-type-options",
  "referrer-policy",
  "strict-transport-security",
  "content-security-policy",
  "content-security-policy-report-only",
  "cache-control"
]);
const ROUTES = Object.freeze(["/api/health", "/plugin", "/page", "/api/missing", "/missing"]);

const pluginProvider = defineProvider({
  id: "fixture.plugin",
  requires: { fastify: "runtime.fastify" },
  async setup({ fastify }) {
    await fastify.register(async (child) => {
      child.get("/plugin", async () => ({ plugin: true }));
    });
    return {};
  }
});

/** A build's provider registry holding pluginProvider, as a single-file bundle's would. */
const INSTALLED = Object.freeze({
  providers: Object.freeze([pluginProvider]),
  packageOrder: Object.freeze(["@fixture/plugin"]),
  providerPackageOrder: Object.freeze(["@fixture/plugin"]),
  globalUiPaths: Object.freeze([])
});

function requireStaticRuntime() {
  assert.equal(
    typeof createStaticInstalledRuntime,
    "function",
    "@jskit-ai/kernel/server/platform exports createStaticInstalledRuntime, the runtime a bundle with its providers built in starts"
  );
}

/**
 * An empty app root, for a runtime that reads no installed packages or finds none.
 * @param {import("node:test").TestContext} context
 */
async function emptyAppRoot(context) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-static-runtime-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
  return appRoot;
}

/**
 * The same server started by one runtime: pluginProvider from the app's providers for createInstalledRuntime (the
 * fixture app installs no package), from the build's registry for the static runtime; a page and a not-found
 * fallback after. Returns what each route answers: its status, its security headers and, for a page, its body.
 * @param {import("node:test").TestContext} context
 * @param {"installed" | "static"} kind
 * @param {Record<string, string>} env
 */
async function answersOf(context, kind, env) {
  const appRoot = await emptyAppRoot(context);
  const app = Fastify();
  context.after(() => app.close());
  app.get("/api/health", async () => ({ ok: true }));
  const options = { appRoot, env, logger: silentLogger, fastify: app };
  if (kind === "static") {
    await createStaticInstalledRuntime({ ...options, installed: INSTALLED });
  } else {
    await createInstalledRuntime({ ...options, providers: [pluginProvider] });
  }
  app.get("/page", async (request, reply) => reply.type("text/html; charset=utf-8").send("<html><head></head><body>Page</body></html>"));
  app.setNotFoundHandler(async (request, reply) => reply.code(404).type("text/html; charset=utf-8").send("<html><head></head><body>Shell</body></html>"));
  const answers = {};
  for (const url of ROUTES) {
    const response = await app.inject({ method: "GET", url });
    answers[url] = {
      status: response.statusCode,
      headers: Object.fromEntries(SECURITY_HEADERS.map((name) => [name, response.headers[name]])),
      ...(String(response.headers["content-type"]).startsWith("text/html") ? { body: response.body } : {})
    };
  }
  return answers;
}

/**
 * The message a runtime's start refuses with, or null when it starts.
 * @param {import("node:test").TestContext} context
 * @param {"installed" | "static"} kind
 * @param {Record<string, string>} env
 */
async function refusalOf(context, kind, env) {
  const appRoot = await emptyAppRoot(context);
  const app = Fastify();
  context.after(() => app.close());
  const options = { appRoot, env, logger: silentLogger, fastify: app };
  try {
    await (kind === "static"
      ? createStaticInstalledRuntime({ ...options, installed: INSTALLED })
      : createInstalledRuntime({ ...options, providers: [pluginProvider] }));
    return null;
  } catch (error) {
    return error.message;
  }
}

test("a static installed runtime sends what createInstalledRuntime sends, in production and in development", async (context) => {
  requireStaticRuntime();
  const production = await answersOf(context, "static", PRODUCTION);
  assert.deepEqual(production, await answersOf(context, "installed", PRODUCTION));
  for (const url of ROUTES) {
    assert.equal(production[url].headers["x-content-type-options"], "nosniff", url);
    assert.equal(production[url].headers["referrer-policy"], "strict-origin-when-cross-origin", url);
    assert.equal(production[url].headers["strict-transport-security"], "max-age=31536000", url);
    assert.equal(production[url].headers["content-security-policy"], "frame-ancestors 'self'", url);
    assert.match(production[url].headers["content-security-policy-report-only"], /^default-src 'self'; /u, url);
  }
  assert.equal(production["/api/health"].headers["cache-control"], "no-store, no-cache, must-revalidate");
  assert.equal(production["/api/missing"].headers["cache-control"], "no-store, no-cache, must-revalidate");
  assert.equal(production["/page"].headers["cache-control"], undefined);
  assert.equal(production["/page"].body, '<html><head><meta name="jskit-app-environment" content="production"></head><body>Page</body></html>');

  const development = { APP_ENV: "development", NODE_ENV: "development" };
  const developmentAnswers = await answersOf(context, "static", development);
  assert.deepEqual(developmentAnswers, await answersOf(context, "installed", development));
  assert.equal(developmentAnswers["/page"].headers["strict-transport-security"], undefined);
  assert.equal(developmentAnswers["/page"].headers["content-security-policy"], undefined);
  assert.equal(developmentAnswers["/page"].headers["x-content-type-options"], "nosniff");
});

test("a static installed runtime refuses to start where createInstalledRuntime refuses", async (context) => {
  requireStaticRuntime();
  for (const env of [
    {},
    { APP_ENV: "prod", NODE_ENV: "production" },
    { APP_ENV: "production" },
    { APP_ENV: "production", NODE_ENV: "development" },
    { APP_ENV: "staging", NODE_ENV: "development" },
    { ...PRODUCTION, SIDE_EFFECTS: "live" },
    { ...PRODUCTION, PROD_DB_NAME: "shop" },
    { ...PRODUCTION, AUTH_LOCAL_FILE_PRODUCTION_ACK: "true" },
    { ...PRODUCTION, STAGING_REACHES_REAL_PEOPLE: "true" },
    { APP_ENV: "staging", NODE_ENV: "production", STAGING_REACHES_REAL_PEOPLE: "yes" }
  ]) {
    const refusal = await refusalOf(context, "installed", env);
    assert.ok(refusal, `createInstalledRuntime refuses ${JSON.stringify(env)}`);
    assert.equal(await refusalOf(context, "static", env), refusal, JSON.stringify(env));
  }
  assert.equal(await refusalOf(context, "static", PRODUCTION), null);
});

test("a static installed runtime starts the build's providers between the kernel's and the application's", async (context) => {
  requireStaticRuntime();
  const appRoot = await emptyAppRoot(context);
  let reachable = true;
  const example = defineProvider({
    id: "feature.example",
    requires: { env: "runtime.env" },
    optional: { health: "runtime.health" },
    provides: { example: "feature.example" },
    setup({ env, health }) {
      health.register("example", async () => {
        if (!reachable) {
          throw new Error("Example unreachable.");
        }
      });
      return { example: { name: env.APP_NAME } };
    }
  });
  let observed = null;
  const observer = defineProvider({
    id: "fixture.observer",
    requires: { example: "feature.example", actions: "runtime.actions" },
    setup(dependencies) {
      observed = dependencies;
    }
  });
  const installed = await createStaticInstalledRuntime({
    appRoot,
    env: { APP_ENV: "test", APP_NAME: "Books" },
    logger: silentLogger,
    providers: [observer],
    installed: {
      providers: [example],
      packageOrder: ["@fixture/example", "@fixture/pages"],
      providerPackageOrder: ["@fixture/example"],
      globalUiPaths: ["/console"]
    }
  });
  context.after(() => installed.runtime.shutdown());

  assert.equal(observed.example.name, "Books");
  assert.equal(typeof observed.actions.execute, "function");
  assert.deepEqual(installed.diagnostics.providerOrder, ["feature.example", "runtime.events", "runtime.actions", "fixture.observer"]);
  assert.deepEqual(installed.packageOrder, ["@fixture/example", "@fixture/pages"]);
  assert.deepEqual(installed.providerPackageOrder, ["@fixture/example"]);
  assert.deepEqual(installed.globalUiPaths, ["/console"]);
  assert.deepEqual(await installed.health.check(), { ok: true, checks: { example: { ok: true } } });
  reachable = false;
  assert.deepEqual(await installed.health.check(), { ok: false, checks: { example: { ok: false } } });

  await assert.rejects(
    createStaticInstalledRuntime({ appRoot, env: { APP_ENV: "test" }, logger: silentLogger }),
    { message: "createStaticInstalledRuntime requires installed: the providers, packageOrder and providerPackageOrder its build collected." }
  );
});
