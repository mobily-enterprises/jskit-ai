import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createResourceHost } from "./resourceHost.js";
import { createResourceRuntime } from "./resourceRuntime.js";

/**
 * Tables owned outside a JSKIT server, for code such as a command-line script: a resource runtime of its own on the
 * application's Knex, with the handles of the tables it owns and, when it declares a system scope, its system
 * context factory. A JSKIT application owns its tables through a feature instead, so each table has one owner.
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
  return Object.freeze({
    resources,
    ...(systemScope === undefined ? {} : { systemContext: runtime.declareSystemScope(feature, systemScope) })
  });
}

export { createStandaloneResources };
