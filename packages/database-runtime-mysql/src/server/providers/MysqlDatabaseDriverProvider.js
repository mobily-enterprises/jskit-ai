import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import * as mysqlDriver from "../../shared/index.js";

const MysqlDatabaseDriverProvider = defineProvider({
  id: "runtime.database.driver.mysql",
  provides: {
    driver: "runtime.database.driver"
  },
  setup() {
    return {
      driver: Object.freeze({ ...mysqlDriver })
    };
  }
});

export { MysqlDatabaseDriverProvider };
