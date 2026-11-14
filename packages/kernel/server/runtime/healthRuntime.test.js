import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createHealthRuntime } from "./healthRuntime.js";

function createRecordingLogger() {
  const warnings = [];
  return Object.freeze({
    warnings,
    logger: { ...silentLogger, warn: (fields, message) => warnings.push({ fields, message }) }
  });
}

test("health passes with no checks, and fails when one check fails, without its error in the result", async () => {
  const { logger, warnings } = createRecordingLogger();
  const health = createHealthRuntime({ logger });
  assert.deepEqual(await health.check(), { ok: true, checks: {} });

  health.register("cache", async () => {});
  health.register("database", async () => {
    throw new Error("connect ECONNREFUSED 10.0.0.5:3306");
  });
  const result = await health.check();
  assert.deepEqual(result, { ok: false, checks: { cache: { ok: true }, database: { ok: false } } });
  assert.doesNotMatch(JSON.stringify(result), /ECONNREFUSED/u);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].fields.healthCheck, "database");
  assert.match(warnings[0].fields.err.message, /ECONNREFUSED/u);
});

test("a check that hangs fails after the timeout, and calls during a run share it", async () => {
  const { logger, warnings } = createRecordingLogger();
  const health = createHealthRuntime({ logger, timeoutMs: 30 });
  let runs = 0;
  health.register("database", () => {
    runs += 1;
    return new Promise(() => {});
  });
  const started = Date.now();
  const results = await Promise.all([health.check(), health.check(), health.check()]);
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(results.map((result) => result.ok), [false, false, false]);
  assert.equal(runs, 1);
  assert.equal(warnings[0].message, "Health check timed out.");

  await health.check();
  assert.equal(runs, 2);
});

test("a health check needs a lowercase id, a function and an id of its own", () => {
  const health = createHealthRuntime({ logger: silentLogger });
  assert.throws(() => health.register("Database", async () => {}), /must be lowercase/u);
  assert.throws(() => health.register("database", "select 1"), /must be a function/u);
  health.register("database", async () => {});
  assert.throws(() => health.register("database", async () => {}), /already registered/u);
});

test("the installed runtime's health runs the checks its providers register", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-health-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({ name: "fixture-app", private: true }));
  let reachable = true;
  const queueProvider = defineProvider({
    id: "fixture.queue",
    optional: { health: "runtime.health" },
    setup({ health }) {
      health.register("queue", async () => {
        if (!reachable) {
          throw new Error("Queue unreachable.");
        }
      });
    }
  });
  const installed = await createInstalledRuntime({ appRoot, env: { APP_ENV: "test" }, logger: silentLogger, providers: [queueProvider] });
  assert.deepEqual(await installed.health.check(), { ok: true, checks: { queue: { ok: true } } });
  reachable = false;
  assert.deepEqual(await installed.health.check(), { ok: false, checks: { queue: { ok: false } } });
  await installed.runtime.shutdown();
});
