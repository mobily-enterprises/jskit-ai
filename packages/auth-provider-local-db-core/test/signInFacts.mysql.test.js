import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { exerciseSignInFacts } from "../../auth-provider-local-core/test-support/signInFactsScenario.js";
import { openLocalAuthDatabase } from "./support/mysqlLocalAuth.js";

// On MariaDB the new columns are nullable timestamps that no other write of their row sets: the scenario's waiting
// email change and visits leave them as they were.
test("a session keeps how it was signed in, and an account when its credentials changed (MariaDB)", async (context) => {
  requireTestDatabase(process.env);
  const { backend } = await openLocalAuthDatabase(context, "da_local_sign_in_facts");
  await exerciseSignInFacts(context, backend);
});
