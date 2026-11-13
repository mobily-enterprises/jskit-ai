// One server of the two-server replay test, in a process of its own: local auth on the database backend, over the
// SQLite file the test migrated (argv[2]), trusting the issuer the AUTH_PASS_* env names. It signs in once with the
// pass in argv[3] and prints the outcome as JSON.
import createKnex from "knex";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createLocalAuthService } from "../../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../../auth-provider-local-core/test-support/localService.js";
import { passIdentityByEmail } from "../../../auth-provider-local-core/test-support/passSignInScenario.js";
import { AuthLocalDatabaseBackendProvider } from "../../src/server/providers/AuthLocalDatabaseBackendProvider.js";
import { localAuthRuntimeInputs } from "./localAuthRuntime.js";

const [filename, pass] = process.argv.slice(2);
const knex = createKnex({ client: "better-sqlite3", connection: { filename }, useNullAsDefault: true });
try {
  const { inputs } = await localAuthRuntimeInputs(knex);
  let backend = null;
  const probe = defineProvider({
    id: "test.auth.pass-server",
    requires: { started: "auth.local.backend" },
    setup({ started }) {
      backend = started;
      return {};
    }
  });
  await createCapabilityRuntime({ inputs, providers: [AuthLocalDatabaseBackendProvider, probe] }).start();
  const { AUTH_PASS_PUBLIC_KEY, AUTH_PASS_AUDIENCE, AUTH_PASS_RESOURCE } = process.env;
  const service = createLocalAuthService({
    ...localServiceOptions({ env: { AUTH_PASS_PUBLIC_KEY, AUTH_PASS_AUDIENCE, AUTH_PASS_RESOURCE } }),
    backend,
    passIdentity: passIdentityByEmail(backend)
  });
  let outcome;
  try {
    outcome = { ok: true, userId: (await service.signInWithPass({ pass })).actor.id };
  } catch (error) {
    outcome = { ok: false, status: error.status, code: error.code };
  }
  process.stdout.write(JSON.stringify(outcome));
} finally {
  await knex.destroy();
}
