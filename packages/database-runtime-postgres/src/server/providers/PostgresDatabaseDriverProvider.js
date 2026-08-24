import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import * as postgresDriver from "../../shared/index.js";

const PostgresDatabaseDriverProvider = defineProvider({
  id: "runtime.database.driver.postgres",
  provides: {
    driver: "runtime.database.driver"
  },
  setup() {
    return {
      driver: Object.freeze({ ...postgresDriver })
    };
  }
});

export { PostgresDatabaseDriverProvider };
