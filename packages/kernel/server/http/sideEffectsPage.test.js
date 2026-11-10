import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import {
  pageSideEffectsMode,
  resolveSideEffectsMode,
  sideEffectsAreLive,
  withSideEffectsMeta
} from "@jskit-ai/kernel/shared/support/sideEffects";

const PAGE = "<!doctype html><html><head><title>App</title></head><body><div id=\"app\"></div></body></html>";

function recordingLogger() {
  const lines = [];
  const record = (level) => (details, message) => lines.push({ level, details, message });
  return { lines, debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") };
}

/**
 * A Fastify server assembled the way an application's server.js assembles it, with the page sent as text, as a
 * Buffer with its own length, and JSON.
 * @param {import("node:test").TestContext} context
 * @param {Record<string, string>} env
 */
async function createAppServer(context, env) {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-side-effects-page-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
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

test("SIDE_EFFECTS is live only when it is exactly live", () => {
  assert.equal(resolveSideEffectsMode({}), "simulate", "unset simulates");
  assert.equal(resolveSideEffectsMode({ SIDE_EFFECTS: "" }), "simulate");
  assert.equal(resolveSideEffectsMode({ SIDE_EFFECTS: "simulate" }), "simulate");
  assert.equal(resolveSideEffectsMode({ SIDE_EFFECTS: "LIVE" }), "simulate");
  assert.equal(resolveSideEffectsMode({ SIDE_EFFECTS: " live" }), "simulate");
  assert.equal(resolveSideEffectsMode({ SIDE_EFFECTS: "true" }), "simulate");
  assert.equal(resolveSideEffectsMode({ SIDE_EFFECTS: "live" }), "live");
  assert.equal(sideEffectsAreLive({ SIDE_EFFECTS: "live" }), true);
  assert.equal(sideEffectsAreLive({}), false);
});

test("the meta tag goes first in the head, replaces an earlier one and leaves text without a head alone", () => {
  const page = withSideEffectsMeta(PAGE, "simulate");
  assert.match(page, /^<!doctype html><html><head><meta name="jskit-side-effects" content="simulate"><title>/u);
  assert.equal(withSideEffectsMeta(page, "live").match(/jskit-side-effects/gu).length, 1, "one tag");
  assert.match(withSideEffectsMeta(page, "live"), /content="live"/u);
  assert.match(withSideEffectsMeta("<html><HEAD lang=\"en\"></HEAD></html>", "live"), /<HEAD lang="en"><meta name/u);
  assert.equal(withSideEffectsMeta("<p>No head</p>", "live"), "<p>No head</p>");
});

test("a page reads its side-effects setting from its own document, and nothing from a page that names none", () => {
  const documentWith = (content) => ({
    querySelector(selector) {
      assert.equal(selector, 'meta[name="jskit-side-effects"]');
      return content === null ? null : { getAttribute: () => content };
    }
  });
  assert.equal(pageSideEffectsMode(documentWith("simulate")), "simulate");
  assert.equal(pageSideEffectsMode(documentWith("live")), "live");
  assert.equal(pageSideEffectsMode(documentWith("loud")), "");
  assert.equal(pageSideEffectsMode(documentWith(null)), "");
  assert.equal(pageSideEffectsMode(undefined), "");
});

test("a simulating server names simulate in every page it sends, with the right length, and leaves JSON alone", async (context) => {
  const { app } = await createAppServer(context, { NODE_ENV: "production" });
  for (const url of ["/", "/somewhere/deep", "/buffer"]) {
    const response = await app.inject({ method: "GET", url });
    assert.match(response.body, /<head><meta name="jskit-side-effects" content="simulate"><title>/u, url);
    assert.equal(Number(response.headers["content-length"]), Buffer.byteLength(response.body), url);
  }
  const data = await app.inject({ method: "GET", url: "/api/data" });
  assert.deepEqual(data.json(), { ok: true });
});

test("a live server names live in its pages", async (context) => {
  const { app } = await createAppServer(context, { SIDE_EFFECTS: "live" });
  const response = await app.inject({ method: "GET", url: "/" });
  assert.match(response.body, /<meta name="jskit-side-effects" content="live">/u);
});

test("the server says once whether it acts for real, warning when production simulates", async (context) => {
  const production = await createAppServer(context, { NODE_ENV: "production" });
  const productionLines = production.logger.lines.filter(({ details }) => details?.sideEffects);
  assert.equal(productionLines.length, 1);
  assert.equal(productionLines[0].level, "warn");
  assert.match(productionLines[0].message, /test copy.*Set SIDE_EFFECTS=live to act for real/su);

  const development = await createAppServer(context, {});
  assert.equal(development.logger.lines.find(({ details }) => details?.sideEffects)?.level, "info");

  const live = await createAppServer(context, { NODE_ENV: "production", SIDE_EFFECTS: "live" });
  const liveLine = live.logger.lines.find(({ details }) => details?.sideEffects);
  assert.equal(liveLine.level, "info");
  assert.match(liveLine.message, /live: email, messages and payments are sent for real/u);
});
