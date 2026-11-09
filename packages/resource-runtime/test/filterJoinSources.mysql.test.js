import test from "node:test";
import { ownMysqlDatabase } from "./support/mysqlDatabase.js";
import { filterJoinSourcesCases } from "./support/filterJoinSourcesCases.js";

// MariaDB or MySQL, each case in a database of its own beside TEST_DB_NAME.
for (const [name, run] of filterJoinSourcesCases(ownMysqlDatabase)) {
  test(name, run);
}
