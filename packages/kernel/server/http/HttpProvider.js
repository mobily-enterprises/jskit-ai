import { defineProvider } from "../../shared/capabilities/defineProvider.js";
import { createCapabilityHttpRuntime } from "./capabilityHttpRuntime.js";

const HttpProvider = defineProvider({
  id: "runtime.http",
  requires: {
    actions: "runtime.actions",
    fastify: "runtime.fastify"
  },
  provides: {
    http: "runtime.http"
  },
  /**
   * @param {object} dependencies
   * @param {import("../types.js").ActionCatalogue} dependencies.actions
   * @param {import("../types.js").RuntimeFastify} dependencies.fastify
   */
  setup({ actions, fastify }) {
    return {
      http: createCapabilityHttpRuntime({ actions, fastify })
    };
  },
  /**
   * @param {object} _dependencies
   * @param {{ outputs: { http: import("../types.js").RuntimeHttp } }} lifecycle
   */
  async boot(_dependencies, { outputs }) {
    await outputs.http.start();
  }
});

export { HttpProvider };
