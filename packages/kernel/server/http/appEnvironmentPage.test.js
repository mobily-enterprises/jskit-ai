import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import {
  appEnvironment,
  isDeployed,
  pageAppEnvironment,
  withAppEnvironmentMeta
} from "@jskit-ai/kernel/shared/support/appEnvironment";

const PAGE = "<!doctype html><html><head><title>App</title></head><body><div id=\"app\"></div></body></html>";
const STAGING = Object.freeze({ APP_ENV: "staging", NODE_ENV: "production" });
const PRODUCTION = Object.freeze({ APP_ENV: "production", NODE_ENV: "production" });

function recordingLogger() {
  const lines = [];
  const record = (level) => (details, message) => lines.push({ level, details, message });
  return { lines, debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") };
}

async function fixtureAppRoot(context) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-app-environment-page-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
  return appRoot;
}

/**
 * A Fastify server assembled the way an application's server.js assembles it, with the page sent as text, as a
 * Buffer with its own length, and JSON.
 * @param {import("node:test").TestContext} context
 * @param {Record<string, string>} env
 */
async function createAppServer(context, env) {
  const appRoot = await fixtureAppRoot(context);
  const app = Fastify();
  context.after(() => app.close());
  const logger = recordingLogger();
  await createInstalledRuntime({ appRoot, env, logger, fastify: app });
  app.get("/api/data", async () => ({ ok: true }));
  app.get("/buffer", async (request, reply) => {
    const page = Buffer.from(PAGE, "utf8");
    return reply.type("text/html").header("content-length", String(page.length)).send(page);
  });
  app.setNotFoundHandler(async (request, reply) => reply.type("text/html; charset=utf-8").send(PAGE));
  return { app, logger };
}

test("APP_ENV names one of four environments exactly; anything else, unset included, refuses naming the fix", () => {
  for (const environment of ["development", "test", "staging", "production"]) {
    assert.equal(appEnvironment({ APP_ENV: environment }), environment);
  }
  assert.equal(appEnvironment({ APP_ENV: " staging " }), "staging");
  assert.throws(() => appEnvironment({}), {
    message: "APP_ENV is not set. Set APP_ENV to development, test, staging or production: development on a " +
      "developer's machine or in a preview, staging or production (with NODE_ENV=production) on a server."
  });
  assert.throws(() => appEnvironment({ APP_ENV: " " }), { message: /^APP_ENV is not set\./u });
  for (const value of ["Production", "prod", "local", "live"]) {
    assert.throws(() => appEnvironment({ APP_ENV: value }), {
      message: `APP_ENV is "${value}", which is not an environment JSKIT knows. Set APP_ENV to development, test, ` +
        "staging or production."
    });
  }
  assert.equal(isDeployed({ APP_ENV: "staging" }), true);
  assert.equal(isDeployed({ APP_ENV: "production" }), true);
  assert.equal(isDeployed({ APP_ENV: "development", NODE_ENV: "production" }), false, "NODE_ENV decides nothing");
  assert.equal(isDeployed({ APP_ENV: "test" }), false);
  assert.throws(() => isDeployed({ NODE_ENV: "production" }), { message: /^APP_ENV is not set\./u });
});

test("the meta tag goes first in the head, replaces an earlier one and leaves text without a head alone", () => {
  const page = withAppEnvironmentMeta(PAGE, "staging");
  assert.match(page, /^<!doctype html><html><head><meta name="jskit-app-environment" content="staging"><title>/u);
  assert.equal(withAppEnvironmentMeta(page, "production").match(/jskit-app-environment/gu).length, 1, "one tag");
  assert.match(withAppEnvironmentMeta(page, "production"), /content="production"/u);
  assert.match(withAppEnvironmentMeta("<html><HEAD lang=\"en\"></HEAD></html>", "test"), /<HEAD lang="en"><meta name/u);
  assert.equal(withAppEnvironmentMeta("<p>No head</p>", "test"), "<p>No head</p>");
});

test("a page reads its environment from its own document, and nothing from a page that names none", () => {
  const documentWith = (content) => ({
    querySelector(selector) {
      assert.equal(selector, 'meta[name="jskit-app-environment"]');
      return content === null ? null : { getAttribute: () => content };
    }
  });
  for (const environment of ["development", "test", "staging", "production"]) {
    assert.equal(pageAppEnvironment(documentWith(environment)), environment);
  }
  assert.equal(pageAppEnvironment(documentWith("simulate")), "");
  assert.equal(pageAppEnvironment(documentWith(null)), "");
  assert.equal(pageAppEnvironment(undefined), "");
});

test("a server names its APP_ENV in every page it sends, with the right length, and leaves JSON alone", async (context) => {
  const { app } = await createAppServer(context, STAGING);
  for (const url of ["/", "/somewhere/deep", "/buffer"]) {
    const response = await app.inject({ method: "GET", url });
    assert.match(response.body, /<head><meta name="jskit-app-environment" content="staging"><title>/u, url);
    assert.equal(Number(response.headers["content-length"]), Buffer.byteLength(response.body), url);
  }
  const data = await app.inject({ method: "GET", url: "/api/data" });
  assert.deepEqual(data.json(), { ok: true });

  const production = await createAppServer(context, PRODUCTION);
  assert.match((await production.app.inject({ method: "GET", url: "/" })).body,
    /<meta name="jskit-app-environment" content="production">/u);
});

test("the server says once where it runs and what that means for what it sends", async (context) => {
  const lineOf = ({ logger }) => {
    const lines = logger.lines.filter(({ details }) => details?.appEnv);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, "info");
    return lines[0].message;
  };
  assert.match(lineOf(await createAppServer(context, PRODUCTION)), /^APP_ENV is production: email, SMS.*act for real\.$/u);
  assert.match(lineOf(await createAppServer(context, { APP_ENV: "development" })),
    /^APP_ENV is development: .*logged, not sent; payments use the sandbox; pages show a "Development" banner\.$/u);
  assert.match(lineOf(await createAppServer(context, STAGING)),
    /^APP_ENV is staging: email is logged \(STAGING_EMAIL_TO is not set\), SMS is logged \(STAGING_SMS_TO is not set\);/u);
  assert.match(lineOf(await createAppServer(context, { ...STAGING, STAGING_EMAIL_TO: "qa@example.com" })),
    /email goes only to qa@example\.com \(STAGING_EMAIL_TO\)/u);
});

test("a server refuses to start without a known APP_ENV, naming the fix", async (context) => {
  const appRoot = await fixtureAppRoot(context);
  const start = (env) => createInstalledRuntime({ appRoot, env, logger: recordingLogger(), fastify: Fastify() });
  await assert.rejects(start({}), { message: /^APP_ENV is not set\. Set APP_ENV to development, test, staging or production/u });
  await assert.rejects(start({ NODE_ENV: "production" }), { message: /^APP_ENV is not set\./u });
  await assert.rejects(start({ APP_ENV: "prod" }), { message: /^APP_ENV is "prod", which is not an environment JSKIT knows\./u });
});

test("a staging or production server refuses to start unless NODE_ENV is production", async (context) => {
  const appRoot = await fixtureAppRoot(context);
  const start = (env) => createInstalledRuntime({ appRoot, env, logger: recordingLogger(), fastify: Fastify() });
  await assert.rejects(start({ APP_ENV: "staging", NODE_ENV: "development" }), {
    message: "APP_ENV is staging, so NODE_ENV must be production, and it is development. Set NODE_ENV=production: it " +
      "only picks optimised builds, and APP_ENV decides everything else."
  });
  await assert.rejects(start({ APP_ENV: "production" }), {
    message: /^APP_ENV is production, so NODE_ENV must be production, and it is not set\. Set NODE_ENV=production/u
  });
  await assert.rejects(start({ APP_ENV: "production", NODE_ENV: "Production" }), { message: /and it is Production\./u });
  await assert.doesNotReject(start({ APP_ENV: "development", NODE_ENV: "production" }));
  await assert.doesNotReject(start({ APP_ENV: "test" }));
});

test("a server refuses to start while SIDE_EFFECTS is set, saying APP_ENV replaced it", async (context) => {
  const appRoot = await fixtureAppRoot(context);
  const start = (env) => createInstalledRuntime({ appRoot, env, logger: recordingLogger(), fastify: Fastify() });
  const message = "SIDE_EFFECTS was replaced by APP_ENV: remove SIDE_EFFECTS. APP_ENV=production acts for real; " +
    "staging sends email and SMS only to STAGING_EMAIL_TO and STAGING_SMS_TO; development and test only log.";
  await assert.rejects(start({ ...PRODUCTION, SIDE_EFFECTS: "live" }), { message });
  await assert.rejects(start({ APP_ENV: "development", SIDE_EFFECTS: "simulate" }), { message });
  await assert.rejects(start({ SIDE_EFFECTS: "live" }), { message }, "before the missing APP_ENV, so the fix says what replaced it");
  await assert.doesNotReject(start({ APP_ENV: "development", SIDE_EFFECTS: "" }));
});
