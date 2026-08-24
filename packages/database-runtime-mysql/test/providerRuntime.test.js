import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { MysqlDatabaseDriverProvider } from "../src/server/providers/MysqlDatabaseDriverProvider.js";

test("MysqlDatabaseDriverProvider provides the exclusive database driver capability", async () => {
  let driver;
  const consumer = defineProvider({
    id: "test.mysql.consumer",
    requires: { databaseDriver: "runtime.database.driver" },
    setup({ databaseDriver }) {
      driver = databaseDriver;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({ providers: [MysqlDatabaseDriverProvider, consumer] });

  await runtime.start();
  assert.equal(driver.DIALECT_ID, "mysql2");
  assert.equal(driver.getDialectId(), "mysql2");
  await runtime.shutdown();
});
