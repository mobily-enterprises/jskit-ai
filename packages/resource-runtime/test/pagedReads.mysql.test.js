import test from "node:test";
import { ownMysqlDatabase } from "./support/mysqlDatabase.js";
import { pagedReadsCases } from "./support/pagedReadsCases.js";

// MariaDB or MySQL, each case in a database of its own beside TEST_DB_NAME.
for (const [name, run] of pagedReadsCases(ownMysqlDatabase)) {
  test(name, run);
}
