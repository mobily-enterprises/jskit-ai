import { defineFeature } from "@jskit-ai/kernel/server/features";
import { resolveSideEffectsMode } from "@jskit-ai/kernel/shared/support/sideEffects";
import { createSchema } from "json-rest-schema";
import { createConnectionService } from "./connectionService.js";

const integrationId = Object.freeze({ type: "string", required: true, minLength: 1, maxLength: 200 });
const verificationInput = Object.freeze({ type: "object", additionalProperties: true });
// Every connectors action serves API and internal callers on app surfaces.
const connectorsActionReach = Object.freeze({
  channels: Object.freeze(["api", "internal"]),
  surfaces: Object.freeze(["app"])
});

/** @param {{ connections: import("./types.js").ConnectorsCore }} dependencies */
function createConnectorsActions({ connections }) {
  return Object.freeze([
    Object.freeze({
      id: "connectors.status",
      kind: "query",
      ...connectorsActionReach,
      input: { schema: createSchema({ integrationId }) },
      execute: (input, context) => connections.status({ ...input, context })
    }),
    Object.freeze({
      id: "connectors.connect",
      kind: "command",
      ...connectorsActionReach,
      input: { schema: createSchema({ integrationId, verificationInput }) },
      execute: (input, context) => connections.beginAuthorization({ ...input, context })
    }),
    Object.freeze({
      id: "connectors.verifyClientCredentials",
      kind: "command",
      ...connectorsActionReach,
      input: { schema: createSchema({ integrationId, verificationInput }) },
      execute: (input, context) => connections.connectClientCredentials({ ...input, context })
    }),
    Object.freeze({
      id: "connectors.verifyServiceAccount",
      kind: "command",
      ...connectorsActionReach,
      input: { schema: createSchema({ integrationId, verificationInput }) },
      execute: (input, context) => connections.connectServiceAccount({ ...input, context })
    }),
    Object.freeze({
      id: "connectors.verifyApiKey",
      kind: "command",
      ...connectorsActionReach,
      input: { schema: createSchema({ integrationId, verificationInput }) },
      execute: (input, context) => connections.connectApiKey({ ...input, context })
    }),
    Object.freeze({
      id: "connectors.verifyWithoutCredentials",
      kind: "command",
      ...connectorsActionReach,
      input: { schema: createSchema({ integrationId, verificationInput }) },
      execute: (input, context) => connections.connectWithoutCredentials({ ...input, context })
    }),
    Object.freeze({
      id: "connectors.disconnect",
      kind: "command",
      ...connectorsActionReach,
      input: { schema: createSchema({ integrationId }) },
      execute: (input, context) => connections.disconnect({ ...input, context })
    })
  ]);
}

/**
 * The `connectors.core` feature. Given no `store`, it keeps connections in the `connectors.store` capability, which
 * createConnectionStoreFeature() provides on the connector tables; without that feature the app fails at startup, naming it.
 * Its operations marked `sideEffect` follow the application's SIDE_EFFECTS, never an option.
 * @param {Omit<import("./types.js").ConnectionServiceOptions, "store" | "sideEffects" | "logger"> & { store?: import("./types.js").ConnectionStore }} options
 */
function createConnectorsFeature(options) {
  return defineFeature({
    id: "connectors.core",
    domain: "connectors",
    requires: {
      env: "runtime.env",
      logger: "runtime.logger",
      ...(options.store ? {} : { store: "connectors.store" })
    },
    hints: options.store ? {} : {
      "connectors.store": "Register createConnectionStoreFeature({ protection }) from @jskit-ai/connectors-core/server/storage " +
        "in your server providers, or pass createConnectorsFeature({ store })."
    },
    provides: { connections: "connectors.core" },
    /**
     * Operations marked `sideEffect` follow the application's SIDE_EFFECTS: simulated unless it is exactly `live`.
     * @param {{ env: import("@jskit-ai/kernel/server/types").RuntimeEnv, logger: import("@jskit-ai/kernel/server/types").RuntimeLogger, store?: import("./types.js").ConnectionStore }} dependencies
     */
    setup({ env, logger, store = options.store }) {
      return {
        connections: createConnectionService({ ...options, store, sideEffects: resolveSideEffectsMode(env), logger })
      };
    },
    actions({ connections }) {
      return createConnectorsActions({ connections });
    }
  });
}

export { createConnectorsFeature };
