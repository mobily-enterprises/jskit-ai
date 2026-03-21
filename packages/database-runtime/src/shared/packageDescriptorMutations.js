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

function createDatabaseRuntimeDriverDescriptor({
  packageId = "",
  version = "0.1.0",
  driverId = "",
  driverLabel = "",
  driverPackageName = "",
  driverPackageVersion = "",
  providerEntrypoint = "",
  providerExport = "",
  dbHostHint = "",
  dbPortDefault = "",
  dbPortHint = "",
  dbNameHint = "",
  databaseClientMutationId = ""
} = {}) {
  const normalizedPackageId = normalizeText(packageId);
  if (!normalizedPackageId) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires packageId.");
  }

  const normalizedDriverId = normalizeText(driverId);
  if (!normalizedDriverId) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires driverId.");
  }

  const normalizedDriverLabel = normalizeText(driverLabel);
  if (!normalizedDriverLabel) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires driverLabel.");
  }

  const normalizedDriverPackageName = normalizeText(driverPackageName);
  if (!normalizedDriverPackageName) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires driverPackageName.");
  }

  const normalizedDriverPackageVersion = normalizeText(driverPackageVersion);
  if (!normalizedDriverPackageVersion) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires driverPackageVersion.");
  }

  const normalizedProviderEntrypoint = normalizeText(providerEntrypoint);
  if (!normalizedProviderEntrypoint) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires providerEntrypoint.");
  }

  const normalizedProviderExport = normalizeText(providerExport);
  if (!normalizedProviderExport) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires providerExport.");
  }

  const normalizedDbPortDefault = normalizeText(dbPortDefault);
  if (!normalizedDbPortDefault) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires dbPortDefault.");
  }

  const normalizedDbHostHint = normalizeText(dbHostHint);
  if (!normalizedDbHostHint) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires dbHostHint.");
  }

  const normalizedDbPortHint = normalizeText(dbPortHint);
  if (!normalizedDbPortHint) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires dbPortHint.");
  }

  const normalizedDbNameHint = normalizeText(dbNameHint);
  if (!normalizedDbNameHint) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires dbNameHint.");
  }

  const normalizedDatabaseClientMutationId = normalizeText(databaseClientMutationId);
  if (!normalizedDatabaseClientMutationId) {
    throw new TypeError("createDatabaseRuntimeDriverDescriptor requires databaseClientMutationId.");
  }

  const normalizedVersion = normalizeText(version) || "0.1.0";
  const driverToken = `runtime.database.driver.${normalizedDriverId}`;

  return Object.freeze({
    packageVersion: 1,
    packageId: normalizedPackageId,
    version: normalizedVersion,
    options: {
      "db-host": {
        required: false,
        values: [],
        defaultValue: "localhost",
        promptLabel: "Database host",
        promptHint: normalizedDbHostHint
      },
      "db-port": {
        required: false,
        values: [],
        defaultValue: normalizedDbPortDefault,
        promptLabel: "Database port",
        promptHint: normalizedDbPortHint
      },
      "db-name": {
        required: true,
        values: [],
        promptLabel: "Database name",
        promptHint: normalizedDbNameHint
      },
      "db-user": {
        required: true,
        values: [],
        promptLabel: "Database user",
        promptHint: "Database username"
      },
      "db-password": {
        required: true,
        values: [],
        inputType: "password",
        promptLabel: "Database password",
        promptHint: "Database password"
      }
    },
    dependsOn: [
      "@jskit-ai/database-runtime"
    ],
    capabilities: {
      provides: [
        "runtime.database.driver",
        driverToken
      ],
      requires: [
        "runtime.database"
      ]
    },
    runtime: {
      server: {
        providerEntrypoint: normalizedProviderEntrypoint,
        providers: [
          {
            entrypoint: normalizedProviderEntrypoint,
            export: normalizedProviderExport
          }
        ]
      },
      client: {
        providers: []
      }
    },
    metadata: {
      apiSummary: {
        surfaces: [
          {
            subpath: "./server",
            summary: `Exports ${normalizedDriverLabel} database runtime provider.`
          },
          {
            subpath: "./shared",
            summary: `Exports ${normalizedDriverLabel} dialect metadata helpers.`
          },
          {
            subpath: "./client",
            summary: "Exports no runtime API today (reserved client entrypoint)."
          }
        ],
        containerTokens: {
          server: [
            driverToken
          ],
          client: []
        }
      }
    },
    mutations: {
      dependencies: {
        runtime: {
          "@jskit-ai/database-runtime": "0.1.0",
          [normalizedDriverPackageName]: normalizedDriverPackageVersion
        },
        dev: {}
      },
      packageJson: {
        scripts: {}
      },
      procfile: {},
      files: [],
      text: createDatabaseRuntimeEnvTextMutations({
        databaseClient: normalizedDriverPackageName,
        databaseClientMutationId: normalizedDatabaseClientMutationId
      })
    }
  });
}

export {
  createDatabaseRuntimeEnvTextMutations,
  createDatabaseRuntimeDriverDescriptor
};
