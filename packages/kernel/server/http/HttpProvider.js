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
  setup({ actions, fastify }) {
    return {
      http: createCapabilityHttpRuntime({ actions, fastify })
    };
  },
  boot(_dependencies, { outputs }) {
    outputs.http.start();
  }
});

export { HttpProvider };
