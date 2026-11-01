import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createJsonRestApiHost } from "./jsonRestApiHost.js";

const JsonRestApiProvider = defineProvider({
  id: "runtime.json-rest-api",
  requires: {
    database: "runtime.database",
    logger: "runtime.logger"
  },
  provides: {
    jsonRestApi: "runtime.json-rest-api"
  },
  /**
   * @param {object} dependencies
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} dependencies.database
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
   */
  async setup({ database, logger }) {
    return {
      jsonRestApi: await createJsonRestApiHost({ knex: database.knex, logger })
    };
  }
});

export { JsonRestApiProvider };
