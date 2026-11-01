import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createDatabase } from "../database.js";

const DatabaseProvider = defineProvider({
  id: "runtime.database",
  requires: {
    env: "runtime.env",
    driver: "runtime.database.driver"
  },
  provides: {
    database: "runtime.database"
  },
  /**
   * @param {object} dependencies
   * @param {import("../types.js").RuntimeDatabaseDriver} dependencies.driver
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   */
  setup({ driver, env }) {
    return { database: createDatabase({ driver, env }) };
  },
  /**
   * @param {unknown} _dependencies
   * @param {{ outputs: { database: import("../types.js").RuntimeDatabase } }} lifecycle
   */
  async shutdown(_dependencies, { outputs }) {
    await outputs.database.knex.destroy();
  }
});

export { DatabaseProvider };
