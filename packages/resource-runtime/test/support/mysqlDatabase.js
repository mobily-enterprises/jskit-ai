import { createPackageTestKnex } from "@jskit-ai/database-runtime/server/testDatabases";

/**
 * A MariaDB/MySQL database of the test's own beside TEST_DB_NAME, dropped after the test: createPackageTestKnex() on
 * a mysql2 run, whatever the run's DB_CLIENT.
 * @param {import("node:test").TestContext} context
 */
function ownMysqlDatabase(context) {
  return createPackageTestKnex(context, { environment: { ...process.env, DB_CLIENT: "mysql2" } });
}

export { ownMysqlDatabase };
