import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createConnectionStore } from "./connectionStore.js";
import { CONNECTOR_TABLES } from "./connectorResources.js";

const CONNECTION_STORE_FEATURE = "connectors.storage";
const CONNECTION_STORE_SYSTEM_SCOPE = "connector rows are keyed by their owner's application and subject and their integration, which is their scope, not by a workspace or user";

/**
 * The owner of the connector tables in a JSKIT application: it provides the connection store on their handles as
 * `connectors.store`, which createConnectorsFeature() uses when it is given no store. An application that keeps
 * connections in files passes createFileConnectionStore() instead and leaves this feature out.
 * @param {{ protection: import("./types.js").CredentialProtection }} options
 */
function createConnectionStoreFeature({ protection }) {
  return defineFeature({
    id: CONNECTION_STORE_FEATURE,
    domain: "connectors",
    owns: CONNECTOR_TABLES,
    systemScope: CONNECTION_STORE_SYSTEM_SCOPE,
    provides: {
      store: "connectors.store"
    },
    /**
     * @param {object} dependencies
     * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
     * @param {(reason: string) => import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext
     */
    setup({ resources, systemContext }) {
      return { store: createConnectionStore({ resources, systemContext, protection }) };
    }
  });
}

export { CONNECTION_STORE_FEATURE, CONNECTION_STORE_SYSTEM_SCOPE, createConnectionStoreFeature };
