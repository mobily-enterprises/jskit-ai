import { createDatabaseRuntimeDriverDescriptor } from "@jskit-ai/database-runtime/shared/packageDescriptorMutations";

export default createDatabaseRuntimeDriverDescriptor({
  packageId: "@jskit-ai/database-runtime-mysql",
  driverId: "mysql",
  driverLabel: "MySQL",
  driverPackageName: "mysql2",
  driverPackageVersion: "^3.11.2",
  providerEntrypoint: "src/server/providers/DatabaseRuntimeMysqlServiceProvider.js",
  providerExport: "DatabaseRuntimeMysqlServiceProvider",
  dbHostHint: "MySQL host (for example 127.0.0.1)",
  dbPortDefault: "3306",
  dbPortHint: "MySQL port (usually 3306)",
  dbNameHint: "Schema/database name to connect to",
  databaseClientMutationId: "database-client-mysql"
});
