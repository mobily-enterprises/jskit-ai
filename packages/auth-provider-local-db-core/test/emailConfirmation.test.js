import test from "node:test";
import { createLocalAuthService } from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { exerciseEmailConfirmation } from "../../auth-provider-local-core/test-support/emailConfirmationScenario.js";
import { LOCAL_AUTH_DB_TABLES } from "../src/server/lib/index.js";
import { openSqliteLocalAuth } from "./support/localAuthRuntime.js";

test("registration waits for its email to be confirmed, with a hashed, single-use, expiring link (database backend)", async (t) => {
  const { knex, backend } = await openSqliteLocalAuth(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T10:00:00.000Z") });

  // "" leaves AUTH_LOCAL_EMAIL_CONFIRMATION unset: confirmation on, its default.
  const service = createLocalAuthService({ ...localServiceOptions({ env: { AUTH_LOCAL_EMAIL_CONFIRMATION: "" } }), backend });
  await exerciseEmailConfirmation(t, service, async () =>
    JSON.stringify(await knex(LOCAL_AUTH_DB_TABLES.registrations).select()));
});
