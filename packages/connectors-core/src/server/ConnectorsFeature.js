import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createSchema } from "json-rest-schema";
import { createConnectionService } from "./connectionService.js";

function createConnectorsFeature(options) {
  return defineFeature({
    id: "connectors.core",
    domain: "connectors",
    provides: { connections: "connectors.core" },
    setup() {
      return { connections: createConnectionService(options) };
    },
    actions({ connections }) {
      const integrationId = { type: "string", required: true, minLength: 1, maxLength: 200 };
      return [
        ["status", "query", { integrationId }, (input, context) => connections.status({ ...input, context })],
        ["connect", "command", { integrationId, verificationInput: { type: "object", additionalProperties: true } }, (input, context) => connections.beginAuthorization({ ...input, context })],
        ["verifyClientCredentials", "command", { integrationId, verificationInput: { type: "object", additionalProperties: true } }, (input, context) => connections.connectClientCredentials({ ...input, context })],
        ["verifyServiceAccount", "command", { integrationId, verificationInput: { type: "object", additionalProperties: true } }, (input, context) => connections.connectServiceAccount({ ...input, context })],
        ["verifyApiKey", "command", { integrationId, verificationInput: { type: "object", additionalProperties: true } }, (input, context) => connections.connectApiKey({ ...input, context })],
        ["verifyWithoutCredentials", "command", { integrationId, verificationInput: { type: "object", additionalProperties: true } }, (input, context) => connections.connectWithoutCredentials({ ...input, context })],
        ["disconnect", "command", { integrationId }, (input, context) => connections.disconnect({ ...input, context })]
      ].map(([name, kind, fields, execute]) => ({
        id: `connectors.${name}`,
        kind,
        channels: ["api", "internal"],
        surfaces: ["app"],
        idempotency: "none",
        input: { schema: createSchema(fields) },
        execute
      }));
    }
  });
}

export { createConnectorsFeature };
