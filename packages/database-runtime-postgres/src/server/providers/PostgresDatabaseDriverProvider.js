import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { DIALECT_ID } from "../../shared/index.js";

const PostgresDatabaseDriverProvider = defineProvider({
  id: "runtime.database.driver.postgres",
  provides: {
    driver: "runtime.database.driver"
  },
  setup() {
    return {
      driver: Object.freeze({ DIALECT_ID })
    };
  }
});

export { PostgresDatabaseDriverProvider };
