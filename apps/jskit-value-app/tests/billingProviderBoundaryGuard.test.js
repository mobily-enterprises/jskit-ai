import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REMOVED_APP_LOCAL_BILLING_CORE_FILES = Object.freeze([
  "server/modules/billing/service.js",
  "server/modules/billing/checkoutOrchestrator.service.js",
  "server/modules/billing/idempotency.service.js",
  "server/modules/billing/providerOutcomePolicy.js",
  "server/modules/billing/webhook.service.js"
]);

test("legacy app-local billing core wrappers are removed", () => {
  const existing = REMOVED_APP_LOCAL_BILLING_CORE_FILES.filter((relativePath) =>
    existsSync(path.resolve(ROOT_DIR, relativePath))
  );

  assert.deepEqual(existing, []);
});

test("runtime billing wiring imports module seam instead of billing internals", () => {
  const runtimeServicesSource = readFileSync(path.resolve(ROOT_DIR, "server/runtime/services.js"), "utf8");

  assert.match(runtimeServicesSource, /\.\.\/modules\/billing\/index\.js/);
  assert.doesNotMatch(runtimeServicesSource, /\.\.\/modules\/billing\/lib\//);
  assert.doesNotMatch(runtimeServicesSource, /\.\.\/modules\/billing\/repository\.js/);
});

test("billing provider composition remains registry-driven", () => {
  const providersIndexSource = readFileSync(path.resolve(ROOT_DIR, "server/modules/billing/lib/providers/index.js"), "utf8");

  assert.match(providersIndexSource, /\.\/shared\/providerRegistry\.service\.js/);
  assert.match(providersIndexSource, /\.\/shared\/webhookTranslationRegistry\.service\.js/);
  assert.doesNotMatch(providersIndexSource, /\.\/stripe\//);
  assert.doesNotMatch(providersIndexSource, /\.\/paddle\//);
});
