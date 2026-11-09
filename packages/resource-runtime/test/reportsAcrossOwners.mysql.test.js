import test from "node:test";
import { ownMysqlDatabase } from "./support/mysqlDatabase.js";
import { reportsAcrossOwnersCases } from "./support/reportsAcrossOwnersCases.js";

// MariaDB or MySQL, each case in a database of its own beside TEST_DB_NAME.
for (const [name, run] of reportsAcrossOwnersCases(ownMysqlDatabase)) {
  test(name, run);
}
