import assert from "node:assert/strict";
import test from "node:test";
import createKnex from "knex";
import initialMigration from "../migrations/auth_local_db_initial.cjs";
import oauthMigration from "../migrations/auth_local_db_oauth.cjs";
import protectionMigration from "../migrations/auth_local_db_protection.cjs";
import { createLocalAuthService } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { exerciseSignInThrottle } from "../../auth-provider-local-core/test-support/signInThrottleScenario.js";
import { createLocalDbBackend, LOCAL_AUTH_DB_TABLES } from "../src/server/lib/index.js";

test("failed sign-ins make the account wait, doubling, and a success forgets them (database backend)", async (t) => {
  const knex = createKnex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await initialMigration.up(knex);
  await oauthMigration.up(knex);
  await protectionMigration.up(knex);
  const backend = createLocalDbBackend({ knex, transactionManager: { inTransaction: (work) => knex.transaction(work) } });
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T10:00:00.000Z") });

  await exerciseSignInThrottle(t, createLocalAuthService({ ...localServiceOptions(), backend }));

  // The success cleared the account's record and the day-old ones were deleted.
  assert.deepEqual(await knex(LOCAL_AUTH_DB_TABLES.signInFailures).select("email"), []);
});
