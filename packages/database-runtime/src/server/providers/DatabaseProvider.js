import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createDatabase } from "../database.js";

const DatabaseProvider = defineProvider({
  id: "runtime.database",
  requires: {
    env: "runtime.env",
    driver: "runtime.database.driver"
  },
  optional: {
    health: "runtime.health"
  },
  provides: {
    database: "runtime.database"
  },
  /**
   * Opens the database and, when the application has health checks, adds one that the database
   * answers a trivial query.
   * @param {object} dependencies
   * @param {import("../types.js").RuntimeDatabaseDriver} dependencies.driver
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHealth | null} dependencies.health
   */
  setup({ driver, env, health }) {
    const database = createDatabase({ driver, env });
    health?.register("database", () => database.knex.raw("select 1"));
    return { database };
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
