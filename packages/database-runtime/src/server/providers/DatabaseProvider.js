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
    const knex = outputs.database?.knex;
    if (knex && typeof knex.destroy === "function") {
      await knex.destroy();
    }
  }
});

export { DatabaseProvider };
