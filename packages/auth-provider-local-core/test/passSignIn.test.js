import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { AuthLocalProvider } from "../src/server/providers/AuthLocalProvider.js";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { localServiceOptions } from "../test-support/localService.js";
import { createPassIssuer, exercisePassSignIn, passIdentityByEmail, passwordlessAccount } from "../test-support/passSignInScenario.js";

async function temporaryStoreDir(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-pass-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  return storeDir;
}

function startService(backend, issuer, env = issuer.env) {
  return createLocalAuthService({ ...localServiceOptions({ env }), backend, passIdentity: passIdentityByEmail(backend) });
}

test("a one-time pass signs its person in once, and every other pass is refused with its reason (file backend)", async (t) => {
  const issuer = createPassIssuer();
  const backend = createLocalFileBackend({ storeDir: await temporaryStoreDir(t) });
  await exercisePassSignIn(startService(backend, issuer), { backend, issuer });
});

test("the file backend keeps used passes by their hash in its store, so another server on the store refuses them", async (t) => {
  const issuer = createPassIssuer();
  const storeDir = await temporaryStoreDir(t);
  const first = createLocalFileBackend({ storeDir });
  await first.withTransaction((tx) => tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" })));
  const pass = issuer.pass("ada@example.com", { id: "pass-on-two-servers" });

  assert.equal((await startService(first, issuer).signInWithPass({ pass })).actor.id, "usr_ada");
  const stored = await fs.readFile(path.join(storeDir, "passes.passwd"), "utf8");
  assert.match(stored, /^pass:v1:[\w-]{43}:[\w-]+\n$/u);
  assert.doesNotMatch(stored, /pass-on-two-servers/u);

  const second = createLocalFileBackend({ storeDir });
  await assert.rejects(startService(second, issuer).signInWithPass({ pass }), { status: 401, code: "auth.pass.replayed" });
});

test("used passes are forgotten once they could no longer be used, so the store holds only the last minutes' passes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-13T10:00:00.000Z") });
  const issuer = createPassIssuer();
  const storeDir = await temporaryStoreDir(t);
  const backend = createLocalFileBackend({ storeDir });
  await backend.withTransaction((tx) => tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" })));
  const service = startService(backend, issuer);
  await service.signInWithPass({ pass: issuer.pass("ada@example.com") });
  await service.signInWithPass({ pass: issuer.pass("ada@example.com") });
  const lines = async () => (await fs.readFile(path.join(storeDir, "passes.passwd"), "utf8")).split("\n").filter(Boolean);
  assert.equal((await lines()).length, 2);

  // 60 seconds of life and 30 of clock skew later, the next use deletes them.
  t.mock.timers.tick(90_000);
  await service.signInWithPass({ pass: issuer.pass("ada@example.com") });
  assert.equal((await lines()).length, 1);
});

test("without AUTH_PASS_PUBLIC_KEY, pass sign-in is not offered and a pass is refused as unsupported", async (t) => {
  const issuer = createPassIssuer();
  const backend = createLocalFileBackend({ storeDir: await temporaryStoreDir(t) });
  const service = startService(backend, issuer, {});
  await assert.rejects(async () => service.signInWithPass({ pass: issuer.pass("ada@example.com") }),
    { status: 501, code: "AUTH_OPERATION_UNSUPPORTED" });
});

/**
 * Local auth started as an application starts it, on the file store `storeDir`, with the env and capabilities given.
 * @param {import("node:test").TestContext} t
 * @param {string} storeDir
 * @param {Record<string, string>} env
 * @param {Record<string, unknown>} [capabilities]
 */
async function startProvider(t, storeDir, env, capabilities = {}) {
  let authService = null;
  const probe = defineProvider({
    id: "test.auth.pass-probe",
    requires: { service: "auth.service" },
    setup({ service }) {
      authService = service;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.app-root": storeDir,
      "runtime.env": { APP_ENV: "test", AUTH_LOCAL_STORE_DIR: storeDir, APP_PUBLIC_URL: "http://localhost:5173", ...env },
      "runtime.logger": silentLogger,
      "auth.extensions": createAuthExtensions(),
      ...capabilities
    },
    providers: [AuthLocalProvider, probe]
  });
  await runtime.start();
  t.after(() => runtime.shutdown());
  return authService;
}

const startupError = (pattern) => (error) => pattern.test(String(error.details?.cause?.message || error.message));

test("with AUTH_PASS_PUBLIC_KEY set, startup needs its audience, resource and an auth.local.pass-identity, the mapping it signs in through", async (t) => {
  const issuer = createPassIssuer();
  const storeDir = await temporaryStoreDir(t);
  await createLocalFileBackend({ storeDir }).withTransaction((tx) =>
    tx.users.create(passwordlessAccount({ id: "usr_ada", email: "ada@example.com", displayName: "Ada" })));
  const unixUsers = { "auth.local.pass-identity": async (pass) => (pass.subject === "unix:ada" ? "usr_ada" : null) };

  await assert.rejects(startProvider(t, storeDir, issuer.env),
    startupError(/^AUTH_PASS_PUBLIC_KEY turns on one-time pass sign-in, and no auth\.local\.pass-identity is installed/u));
  await assert.rejects(startProvider(t, storeDir, { ...issuer.env, AUTH_PASS_RESOURCE: "" }, unixUsers),
    startupError(/AUTH_PASS_AUDIENCE and AUTH_PASS_RESOURCE are required/u));

  const service = await startProvider(t, storeDir, issuer.env, unixUsers);
  assert.equal((await service.signInWithPass({ pass: issuer.pass("unix:ada") })).actor.email, "ada@example.com");
  await assert.rejects(service.signInWithPass({ pass: issuer.pass("unix:bob") }), { status: 403, code: "auth.pass.unmapped" });
});
