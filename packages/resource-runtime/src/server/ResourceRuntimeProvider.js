import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createResourceHost } from "./resourceHost.js";
import { createResourceRuntime } from "./resourceRuntime.js";
import { registerServerRuntime } from "./standaloneResources.js";

const ResourceRuntimeProvider = defineProvider({
  id: "runtime.resources",
  requires: {
    database: "runtime.database",
    logger: "runtime.logger"
  },
  provides: {
    resources: "runtime.resources"
  },
  /**
   * `runtime.resources`, through which features own their tables, on one
   * json-rest-api host.
   * @param {object} dependencies
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} dependencies.database
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
   */
  async setup({ database, logger }) {
    const api = await createResourceHost({ knex: database.knex, logger });
    const resources = createResourceRuntime({ api });
    registerServerRuntime(database.knex, resources);
    return { resources };
  }
});

export { ResourceRuntimeProvider };
