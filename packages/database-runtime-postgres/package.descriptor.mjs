import { createDatabaseRuntimeDriverDescriptor } from "@jskit-ai/database-runtime/shared/packageDescriptorMutations";

export default createDatabaseRuntimeDriverDescriptor({
  packageId: "@jskit-ai/database-runtime-postgres",
  driverId: "postgres",
  driverLabel: "Postgres",
  driverPackageName: "pg",
  driverPackageVersion: "^8.13.1",
  providerEntrypoint: "src/server/providers/DatabaseRuntimePostgresServiceProvider.js",
  providerExport: "DatabaseRuntimePostgresServiceProvider",
  dbHostHint: "Postgres host (for example 127.0.0.1)",
  dbPortDefault: "5432",
  dbPortHint: "Postgres port (usually 5432)",
  dbNameHint: "Database name to connect to",
  databaseClientMutationId: "database-client-postgres"
});
