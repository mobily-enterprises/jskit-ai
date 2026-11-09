import test from "node:test";
import { ownMysqlDatabase } from "./support/mysqlDatabase.js";
import { lockIncludesCases } from "./support/lockIncludesCases.js";

// MariaDB or MySQL, each case in a database of its own beside TEST_DB_NAME.
for (const [name, run] of lockIncludesCases(ownMysqlDatabase)) {
  test(name, run);
}
