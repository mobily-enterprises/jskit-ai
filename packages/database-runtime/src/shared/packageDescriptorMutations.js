import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function createDatabaseRuntimeEnvTextMutations({
  databaseClient = "",
  databaseClientMutationId = ""
} = {}) {
  const normalizedDatabaseClient = normalizeText(databaseClient);
  if (!normalizedDatabaseClient) {
    throw new TypeError("createDatabaseRuntimeEnvTextMutations requires databaseClient.");
  }

  const normalizedDatabaseClientMutationId = normalizeText(databaseClientMutationId);
  if (!normalizedDatabaseClientMutationId) {
    throw new TypeError("createDatabaseRuntimeEnvTextMutations requires databaseClientMutationId.");
  }

  return Object.freeze([
    Object.freeze({
      file: ".env",
      op: "upsert-env",
      key: "DB_CLIENT",
      value: normalizedDatabaseClient,
      reason: "Configure database client driver for runtime wiring.",
      category: "runtime-config",
      id: normalizedDatabaseClientMutationId
    }),
    Object.freeze({
      file: ".env",
      op: "upsert-env",
      key: "DB_HOST",
      value: "${option:db-host}",
      reason: "Configure database host.",
      category: "runtime-config",
      id: "database-host"
    }),
    Object.freeze({
      file: ".env",
      op: "upsert-env",
      key: "DB_PORT",
      value: "${option:db-port}",
      reason: "Configure database port.",
      category: "runtime-config",
      id: "database-port"
    }),
    Object.freeze({
      file: ".env",
      op: "upsert-env",
      key: "DB_NAME",
      value: "${option:db-name}",
      reason: "Configure database name.",
      category: "runtime-config",
      id: "database-name"
    }),
    Object.freeze({
      file: ".env",
      op: "upsert-env",
      key: "DB_USER",
      value: "${option:db-user}",
      reason: "Configure database user.",
      category: "runtime-config",
      id: "database-user"
    }),
    Object.freeze({
      file: ".env",
      op: "upsert-env",
      key: "DB_PASSWORD",
      value: "${option:db-password}",
      reason: "Configure database password.",
      category: "runtime-config",
      id: "database-password"
    })
  ]);
}

export { createDatabaseRuntimeEnvTextMutations };
