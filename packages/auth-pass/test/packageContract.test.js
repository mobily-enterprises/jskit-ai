import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createInstalledRuntime } from "@jskit-ai/kernel/server/platform";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { PASS_TEXTS, createPassError } from "../src/server/index.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every pass refusal is an AppError with its status, its code and this package's English", () => {
  const refusals = Object.values(PASS_TEXTS).map(createPassError);
  assert.deepEqual(refusals.map(({ code, statusCode }) => [code, statusCode]), [
    ["auth.pass.malformed", 401],
    ["auth.pass.badSignature", 401],
    ["auth.pass.expired", 401],
    ["auth.pass.wrongAudience", 401],
    ["auth.pass.wrongResource", 401],
    ["auth.pass.replayed", 401],
    ["auth.pass.unmapped", 403]
  ]);
  assert.ok(refusals.every((error) => error instanceof AppError && /^This sign-in pass /u.test(error.message)));
  assert.equal(createPassError(PASS_TEXTS.passReplayed).message,
    "This sign-in pass was already used. Open the app again from where you came.");
  assert.throws(() => createPassError({ status: 401, code: "auth.pass.unknown" }), /not in auth-pass's catalog/u);
});

// The reason this package exists: an application with its own sign-in checks passes with it and gets none of
// auth-core's runtime (its auth policy, CSRF and auth actions), because a JSKIT app installs the providers of every
// package it depends on.
test("an application that depends only on auth-pass installs it with no providers", async (context) => {
  const appRoot = await mkdtemp(path.join(tmpdir(), "jskit-auth-pass-app-"));
  context.after(() => rm(appRoot, { recursive: true, force: true }));
  await writeFile(path.join(appRoot, "package.json"), JSON.stringify({
    name: "pass-only-app",
    private: true,
    dependencies: { "@jskit-ai/auth-pass": `file:${PACKAGE_ROOT}` }
  }));

  const installed = await createInstalledRuntime({ appRoot, logger: silentLogger });
  context.after(() => installed.runtime.shutdown());

  assert.deepEqual(installed.packageOrder, ["@jskit-ai/auth-pass"]);
  assert.deepEqual(installed.providerPackageOrder, []);
  assert.deepEqual(installed.diagnostics.providerOrder, ["runtime.events", "runtime.actions"]);
});
