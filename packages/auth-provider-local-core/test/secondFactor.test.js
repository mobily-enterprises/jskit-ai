import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveLocalAuthConfig } from "../src/server/lib/config.js";
import { createLocalAuthService, createLocalFileBackend } from "../src/server/lib/index.js";
import { __testables, deriveSecondFactorKeys, openSecret, sealSecret } from "../src/server/lib/secondFactorCrypto.js";
import { localServiceOptions } from "../test-support/localService.js";
import { sessionCookies } from "../test-support/oauthHarness.js";
import {
  SCENARIO_START,
  SECOND_FACTOR_KEY,
  codeAt,
  exerciseSecondFactor,
  secondFactorServiceOptions
} from "../test-support/secondFactorScenario.js";

const { fromBase32, stepAt, toBase32, totpCodeAt } = __testables;

async function storeDirFor(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-second-factor-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  return storeDir;
}

test("authenticator codes are RFC 6238's: its test vectors, as six-digit codes", () => {
  const secret = toBase32(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(fromBase32(secret), Buffer.from("12345678901234567890"));
  for (const [seconds, code] of [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"]
  ]) {
    assert.equal(totpCodeAt(secret, stepAt(seconds * 1000)), code, `T = ${seconds}`);
  }
});

test("a sealed secret opens only for its own account and with the key that sealed it", () => {
  const keys = deriveSecondFactorKeys(SECOND_FACTOR_KEY);
  const sealed = sealSecret(keys, "usr_ada", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/u);
  assert.equal(sealed.includes("GEZDGNBV"), false);
  assert.notEqual(sealSecret(keys, "usr_ada", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), sealed, "each seal has its own nonce");
  assert.equal(openSecret(keys, "usr_ada", sealed), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.throws(() => openSecret(keys, "usr_bob", sealed), /does not open with AUTH_LOCAL_SECOND_FACTOR_KEY/u);
  assert.throws(() => openSecret(deriveSecondFactorKeys(`${SECOND_FACTOR_KEY}!`), "usr_ada", sealed), /does not open/u);
  assert.throws(() => openSecret(keys, "usr_ada", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), /is not a sealed secret/u);
});

test("an authenticator sets up, proves sessions, refuses wrong, used and expired codes, waits, and resets (file backend)", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: SCENARIO_START });
  const storeDir = await storeDirFor(t);
  const { events, options } = secondFactorServiceOptions();
  const service = createLocalAuthService({ ...options, backend: createLocalFileBackend({ storeDir }) });
  await exerciseSecondFactor(t, {
    service,
    events,
    async storedText() {
      const files = await fs.readdir(storeDir);
      return (await Promise.all(files.map((file) => fs.readFile(path.join(storeDir, file), "utf8")))).join("\n");
    }
  });
});

test("the file store keeps a factor and its session's proof across restarts, and another key cannot open it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: SCENARIO_START });
  const storeDir = await storeDirFor(t);
  const start = (env = {}) => createLocalAuthService({ ...secondFactorServiceOptions({ env }).options, backend: createLocalFileBackend({ storeDir }) });
  const first = start();
  await first.register({ email: "ada@example.com", password: "correct horse battery staple" });
  const cookies = sessionCookies((await first.login({ email: "ada@example.com", password: "correct horse battery staple" })).session);
  const { secret } = await first.startSecondFactorSetup({ cookies });
  const { recoveryCodes } = await first.confirmSecondFactorSetup({ cookies }, { code: codeAt(secret) });

  const restarted = start();
  assert.deepEqual(await restarted.getSecondFactorStatus({ cookies }), {
    enrolled: true,
    enrolledAt: new Date(SCENARIO_START).toISOString(),
    recoveryCodesLeft: 10,
    verifiedAt: new Date(SCENARIO_START).toISOString()
  });
  assert.equal((await restarted.verifySecondFactor({ cookies }, { recoveryCode: recoveryCodes[0] })).recoveryCodesLeft, 9);

  t.mock.timers.tick(30_000);
  const rekeyed = start({ AUTH_LOCAL_SECOND_FACTOR_KEY: `another key, also 32 characters or more` });
  await assert.rejects(rekeyed.verifySecondFactor({ cookies }, { code: codeAt(secret) }), (error) => {
    assert.equal(error.status, undefined, "a key that cannot open the secret is a server failure, not a refusal");
    assert.match(error.message, /does not open with AUTH_LOCAL_SECOND_FACTOR_KEY/u);
    return true;
  });
});

test("a production server has a second factor only with its key, at least 32 characters, and APP_PUBLIC_URL", async (t) => {
  const production = { APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "", AUTH_LOCAL_SECOND_FACTOR_KEY: "" };
  const service = createLocalAuthService({
    ...localServiceOptions({ env: production }),
    backend: createLocalFileBackend({ storeDir: await storeDirFor(t) })
  });
  assert.equal(service.getCapabilities().features.secondFactor, false);
  assert.throws(() => service.getSecondFactorStatus({ cookies: {} }), { status: 501, code: "AUTH_OPERATION_UNSUPPORTED" });
  assert.throws(() => service.listSecondFactors({ userIds: [] }), { status: 501, code: "AUTH_OPERATION_UNSUPPORTED" });

  const resolve = (env) => resolveLocalAuthConfig({
    appRoot: os.tmpdir(),
    env: {
      AUTH_LOCAL_SESSION_SECRET: "test-session-secret",
      AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
      APP_PUBLIC_URL: "https://console.example.com",
      ...env
    },
    fileBackend: false,
    emailRecovery: false
  });
  assert.equal(resolve({ APP_ENV: "production", NODE_ENV: "production" }).secondFactorKey, "");
  assert.equal(resolve({ APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_SECOND_FACTOR_KEY: SECOND_FACTOR_KEY }).secondFactorKey, SECOND_FACTOR_KEY);
  assert.throws(() => resolve({ APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_SECOND_FACTOR_KEY: "too short" }), /at least 32 characters/u);
  assert.throws(() => resolve({ APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_SECOND_FACTOR_KEY: SECOND_FACTOR_KEY, APP_PUBLIC_URL: "" }),
    /APP_PUBLIC_URL is required when AUTH_LOCAL_SECOND_FACTOR_KEY is set/u);
  // Outside production the session secret stands in for the key.
  assert.equal(resolve({ APP_ENV: "development" }).secondFactorKey, "test-session-secret");
  assert.equal(createLocalAuthService({ ...localServiceOptions(), backend: createLocalFileBackend({ storeDir: await storeDirFor(t) }) })
    .getCapabilities().features.secondFactor, true);
});
