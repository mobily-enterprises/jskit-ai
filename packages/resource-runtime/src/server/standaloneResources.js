import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { DuplicateOwnerError } from "./errors.js";
import { createResourceHost } from "./resourceHost.js";
import { createResourceRuntime } from "./resourceRuntime.js";

// The resource runtime a JSKIT server built on each Knex client, so standalone resources never own one of its tables.
const serverRuntimes = new WeakMap();

/**
 * Records the resource runtime a JSKIT server built on its Knex client.
 * @param {object} knex
 * @param {ReturnType<typeof createResourceRuntime>} runtime
 */
function registerServerRuntime(knex, runtime) {
  serverRuntimes.set(knex, runtime);
}

/**
 * Tables owned outside a JSKIT server, for code such as a command-line script: a resource runtime of its own on the
 * application's Knex, with the handles of the tables it owns and, when it declares a system scope, its system
 * context factory. A JSKIT application owns its tables through a feature instead, so each table has one owner: on
 * the Knex client of a JSKIT server, a table one of its features owns is refused here. (A second Knex client on the
 * same database is not recognised; code inside a server uses its features' handles.)
 * @param {object} options
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} options.knex The application's Knex client.
 * @param {string} options.feature The owner's name, as a feature's id.
 * @param {ReadonlyArray<object>} options.owns The table resources it owns, as a feature's `owns`.
 * @param {string} [options.systemScope] Why it works across every workspace and user.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [options.logger]
 */
async function createStandaloneResources({ knex, feature, owns, systemScope, logger = silentLogger }) {
  const runtime = createResourceRuntime({ api: await createResourceHost({ knex, logger }) });
  const resources = await runtime.own(feature, owns);
  const served = new Map((serverRuntimes.get(knex)?.ownedTables() ?? []).map(({ tableName, featureId }) => [tableName, featureId]));
  const taken = runtime.ownedTables().find(({ tableName }) => served.has(tableName));
  if (taken) {
    throw new DuplicateOwnerError(
      `Standalone resources "${feature}" own table "${taken.tableName}", which feature "${served.get(taken.tableName)}" of ` +
      "this server already owns. One table has one owner: inside a server, use that feature's handles."
    );
  }
  return Object.freeze({
    resources,
    ...(systemScope === undefined ? {} : { systemContext: runtime.declareSystemScope(feature, systemScope) })
  });
}

export { createStandaloneResources, registerServerRuntime };
