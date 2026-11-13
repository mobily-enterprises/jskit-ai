import test from "node:test";
import { ownMysqlDatabase } from "./support/mysqlDatabase.js";
import { storedSourceCases } from "./support/storedSourceCases.js";

// MariaDB or MySQL, each case in a database of its own beside TEST_DB_NAME.
for (const [name, run] of storedSourceCases(ownMysqlDatabase)) {
  test(name, run);
}
