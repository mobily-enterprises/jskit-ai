import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import createKnex from "knex";
import initialMigration from "../migrations/auth_local_db_initial.cjs";
import oauthMigration from "../migrations/auth_local_db_oauth.cjs";
import protectionMigration from "../migrations/auth_local_db_protection.cjs";
import { createFirstAccountSetup, createLocalAuthService } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { createLocalDbBackend } from "../src/server/lib/index.js";

test("a production server whose database has no account asks its first registration for the setup code (database backend)", async (t) => {
  const knex = createKnex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await initialMigration.up(knex);
  await oauthMigration.up(knex);
  await protectionMigration.up(knex);
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-db-setup-"));
  t.after(() => fs.rm(storeDir, { recursive: true, force: true }));
  const backend = createLocalDbBackend({ knex, transactionManager: { inTransaction: (work) => knex.transaction(work) } });
  const options = localServiceOptions({
    env: { NODE_ENV: "production", AUTH_LOCAL_STORE_DIR: storeDir, AUTH_LOCAL_RECOVERY_DEV_OUTPUT: "" }
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
