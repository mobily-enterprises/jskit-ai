// readable-check: allow no-direct-knex - infrastructure: a command-line script's connection store on the application's Knex
import { createStandaloneResources } from "@jskit-ai/resource-runtime/server";
import { CONNECTION_STORE_FEATURE, CONNECTION_STORE_SYSTEM_SCOPE } from "./ConnectionStoreFeature.js";
import { createConnectionStore, requireProtection } from "./connectionStore.js";
import { CONNECTOR_TABLES } from "./connectorResources.js";

/**
 * Connections kept encrypted in the connector tables, each locked in a transaction while it is used, for code outside
 * a JSKIT server such as a command-line script: the store owns the connector tables through standalone resources on
 * the application's Knex and answers what createConnectionStoreFeature()'s store answers. A JSKIT application
 * uses that feature instead, so its tables have one owner.
 * @param {object} options
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} options.knex The application's transactional Knex client.
 * @param {import("./types.js").CredentialProtection} options.protection
 */
function createKnexConnectionStore({ knex, protection }) {
  // readable-check: allow method-probe - input validation: the application passes its own Knex instance
  if (typeof knex !== "function" || typeof knex.transaction !== "function") {
    throw new TypeError("createKnexConnectionStore requires the application's Knex instance.");
  }
  requireProtection(protection);
  let ready = null;
  async function compose() {
    const { resources, systemContext } = await createStandaloneResources({
      knex,
      feature: CONNECTION_STORE_FEATURE,
      owns: CONNECTOR_TABLES,
      systemScope: CONNECTION_STORE_SYSTEM_SCOPE
    });
    return createConnectionStore({ resources, systemContext, protection });
  }
  // The handles are built once, on the first call; a failed build is tried again on the next one.
  function store() {
    ready ||= compose().catch((error) => {
      ready = null;
      throw error;
    });
    return ready;
  }

  async function withConnection(slot, work) {
    return (await store()).withConnection(slot, work);
  }
  async function pruneExpiredAttempts(options) {
    return (await store()).pruneExpiredAttempts(options);
  }

  return Object.freeze({
    withConnection,
    pruneExpiredAttempts
  });
}

export { createKnexConnectionStore };
