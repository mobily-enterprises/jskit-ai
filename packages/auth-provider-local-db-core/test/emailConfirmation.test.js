import test from "node:test";
import createKnex from "knex";
import initialMigration from "../migrations/auth_local_db_initial.cjs";
import oauthMigration from "../migrations/auth_local_db_oauth.cjs";
import protectionMigration from "../migrations/auth_local_db_protection.cjs";
import { createLocalAuthService } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { exerciseEmailConfirmation } from "../../auth-provider-local-core/test-support/emailConfirmationScenario.js";
import { createLocalDbBackend, LOCAL_AUTH_DB_TABLES } from "../src/server/lib/index.js";

test("registration waits for its email to be confirmed, with a hashed, single-use, expiring link (database backend)", async (t) => {
  const knex = createKnex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await initialMigration.up(knex);
  await oauthMigration.up(knex);
  await protectionMigration.up(knex);
  const backend = createLocalDbBackend({ knex, transactionManager: { inTransaction: (work) => knex.transaction(work) } });
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T10:00:00.000Z") });

  // "" leaves AUTH_LOCAL_EMAIL_CONFIRMATION unset: confirmation on, its default.
  const service = createLocalAuthService({ ...localServiceOptions({ env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "" } }), backend });
  await exerciseEmailConfirmation(t, service, async () =>
    JSON.stringify(await knex(LOCAL_AUTH_DB_TABLES.registrations).select()));
});
