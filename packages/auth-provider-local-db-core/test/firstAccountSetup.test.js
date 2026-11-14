import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFirstAccountSetup, createLocalAuthService } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";

test("a production server whose database has no account asks its first registration for the setup code (database backend)", async (t) => {
  const { backend } = await openSqliteLocalAuth(t);
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-db-setup-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const options = localServiceOptions({
    env: { APP_ENV: "production", NODE_ENV: "production", AUTH_LOCAL_STORE_DIR: storeDir, AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "" }
  });
  const codes = [];
  const logger = { info() {}, warn: (fields) => codes.push(fields.firstAccountSetupCode), error() {}, debug() {} };

  const start = async () => {
    const firstAccountSetup = createFirstAccountSetup({ backend, config: options.config, logger });
    await firstAccountSetup.start();
    return createLocalAuthService({ ...options, backend, logger, firstAccountSetup });
  };
  const service = await start();
  assert.equal(codes.length, 1);
  assert.equal(service.getCapabilities().features.firstAccountSetupCode, true);
  await assert.rejects(service.register({ email: "owner@example.com", password: "correct horse battery staple" }), {
    code: "auth.local.setup.codeRequired"
  });
  await service.register({ email: "owner@example.com", password: "correct horse battery staple", setupCode: codes[0] });
  assert.equal(service.getCapabilities().features.firstAccountSetupCode, false);

  // Restarted with an account in the database, it makes no code.
  const restarted = await start();
  assert.equal(codes.length, 1);
  assert.equal(restarted.getCapabilities().features.firstAccountSetupCode, false);
});
