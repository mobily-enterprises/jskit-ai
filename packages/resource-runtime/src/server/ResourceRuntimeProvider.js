import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createResourceHost } from "./resourceHost.js";
import { createResourceRuntime } from "./resourceRuntime.js";

const ResourceRuntimeProvider = defineProvider({
  id: "runtime.resources",
  requires: {
    database: "runtime.database",
    logger: "runtime.logger"
  },
  provides: {
    resources: "runtime.resources",
    jsonRestApi: "runtime.json-rest-api"
  },
  /**
   * One json-rest-api host serves both: `runtime.resources`, through which
   * features own their tables, and, until crud-core, users-core and
   * workspaces-core own theirs, the host itself as `runtime.json-rest-api`.
   * @param {object} dependencies
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} dependencies.database
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
   */
  async setup({ database, logger }) {
    const api = await createResourceHost({ knex: database.knex, logger });
    return {
      resources: createResourceRuntime({ api }),
      jsonRestApi: api
    };
  }
});

export { ResourceRuntimeProvider };
