import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createJsonRestApiHost } from "./jsonRestApiHost.js";

const JsonRestApiProvider = defineProvider({
  id: "runtime.json-rest-api",
  requires: {
    database: "runtime.database"
  },
  provides: {
    jsonRestApi: "runtime.json-rest-api"
  },
  async setup({ database }) {
    return {
      jsonRestApi: await createJsonRestApiHost({ knex: database.knex })
    };
  }
});

export { JsonRestApiProvider };
