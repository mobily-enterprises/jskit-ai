import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { normalizeOpaqueId } from "@jskit-ai/kernel/shared/support/normalize";

// The connector tables. A connection is keyed by a hash of its owner's application and subject and its integration,
// and an attempt by a hash of its state, not by a workspace or user column: the key is the row's scope, so the tables
// are public to their owner feature, which reaches them only through keys it computes from a caller's owner and slot.

// A hash the store computes; ciphertext is kept exactly as written.
const key = (column) => Object.freeze({ type: "string", primary: true, required: true, storage: { column } });
const ciphertext = Object.freeze({ type: "string", noTrim: true });

// One owner's connection to one integration: its sealed state, or null while it is disconnected.
const connectorConnectionResource = defineTableResource({
  name: "connectorConnections",
  tableName: "connector_connections",
  idProperty: "connection_key",
  schema: {
    id: key("connection_key"),
    payload: { ...ciphertext, nullable: true }
  }
});

// A pending authorization of one connection, sealed, until it is consumed or expires.
const connectorAuthorizationAttemptResource = defineTableResource({
  name: "connectorAuthorizationAttempts",
  tableName: "connector_authorization_attempts",
  idProperty: "attempt_key",
  sortableFields: ["expiresAt"],
  schema: {
    id: key("attempt_key"),
    connectionKey: { type: "string", required: true, storage: { column: "connection_key" } },
    expiresAt: { type: "integer", required: true, storage: { column: "expires_at" } },
    payload: { ...ciphertext, required: true }
  },
  searchSchema: {
    connectionKey: { type: "string", actualField: "connectionKey" },
    expiresAfter: { type: "number", actualField: "expiresAt", filterOperator: ">" },
    expiredBy: { type: "number", actualField: "expiresAt", filterOperator: "<=" }
  }
});

// The feature's owns entries: each key is an opaque hash, not a numeric id.
const CONNECTOR_TABLES = Object.freeze([connectorConnectionResource, connectorAuthorizationAttemptResource]
  .map((resource) => Object.freeze({ resource, normalizeId: normalizeOpaqueId })));

export { CONNECTOR_TABLES, connectorAuthorizationAttemptResource, connectorConnectionResource };
