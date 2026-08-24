import assert from "node:assert/strict";
import test from "node:test";

import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { PostgresDatabaseDriverProvider } from "../src/server/providers/PostgresDatabaseDriverProvider.js";

test("PostgresDatabaseDriverProvider provides the exclusive database driver capability", async () => {
  let driver;
  const consumer = defineProvider({
    id: "test.postgres.consumer",
    requires: { databaseDriver: "runtime.database.driver" },
    setup({ databaseDriver }) {
      driver = databaseDriver;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({ providers: [PostgresDatabaseDriverProvider, consumer] });

  await runtime.start();
  assert.equal(driver.DIALECT_ID, "pg");
  assert.equal(driver.getDialectId(), "pg");
  await runtime.shutdown();
});
