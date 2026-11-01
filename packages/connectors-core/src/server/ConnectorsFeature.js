import { defineFeature } from "@jskit-ai/kernel/server/features";
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

/** @param {import("./types.js").ConnectionServiceOptions} options */
function createConnectorsFeature(options) {
  return defineFeature({
    id: "connectors.core",
    domain: "connectors",
    provides: { connections: "connectors.core" },
    setup() {
      return { connections: createConnectionService(options) };
    },
    actions({ connections }) {
      return createConnectorsActions({ connections });
    }
  });
}

export { createConnectorsFeature };
