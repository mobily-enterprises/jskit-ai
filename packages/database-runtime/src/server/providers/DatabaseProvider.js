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
  setup({ driver, env }) {
    return { database: createDatabase({ driver, env }) };
  },
  async shutdown(_dependencies, { outputs }) {
    /** @type {import("../types.js").RuntimeDatabase} */
    const database = outputs.database;
    await database.knex.destroy();
  }
});

export { DatabaseProvider };
