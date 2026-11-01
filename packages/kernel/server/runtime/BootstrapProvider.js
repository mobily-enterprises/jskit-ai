import { defineProvider } from "../../shared/capabilities/defineProvider.js";
import { AUTH_POLICY_PUBLIC } from "../../shared/support/policies.js";
import { createBootstrapRuntime } from "./bootstrapRuntime.js";

const BootstrapProvider = defineProvider({
  id: "runtime.bootstrap",
  requires: { http: "runtime.http" },
  provides: { bootstrap: "runtime.bootstrap" },
  /** @param {{ http: import("../types.js").RuntimeHttp }} dependencies */
  setup({ http }) {
    const bootstrap = createBootstrapRuntime();
    http.router.register("GET", "/api/bootstrap", {
      auth: AUTH_POLICY_PUBLIC,
      meta: { tags: ["bootstrap"], summary: "Resolve app bootstrap payload" }
    }, async (request, reply) => {
      reply.code(200).send(await bootstrap.resolve({
        request,
        reply,
        query: request.query || {}
      }));
    });
    return { bootstrap };
  }
});

export { BootstrapProvider };
