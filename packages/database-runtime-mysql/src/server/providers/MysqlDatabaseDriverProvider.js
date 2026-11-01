import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { DIALECT_ID, introspectCrudTableSnapshot } from "../../shared/index.js";

const MysqlDatabaseDriverProvider = defineProvider({
  id: "runtime.database.driver.mysql",
  provides: {
    driver: "runtime.database.driver"
  },
  setup() {
    return {
      driver: Object.freeze({ DIALECT_ID, introspectCrudTableSnapshot })
    };
  }
});

export { MysqlDatabaseDriverProvider };
