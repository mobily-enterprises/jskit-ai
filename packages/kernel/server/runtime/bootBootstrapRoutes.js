import { AUTH_POLICY_PUBLIC } from "../../shared/support/policies.js";
import { resolveBootstrapPayload } from "../registries/bootstrapPayloadContributorRegistry.js";

function bootBootstrapRoutes(app) {
  const router = app.make("jskit.http.router");

  router.register(
    "GET",
    "/api/bootstrap",
    {
      auth: AUTH_POLICY_PUBLIC,
      meta: {
        tags: ["bootstrap"],
        summary: "Resolve app bootstrap payload from registered contributors"
      }
    },
    async function (request, reply) {
      const payload = await resolveBootstrapPayload(app, {
        request,
        reply,
        query: request.query || {}
      });

      reply.code(200).send(payload);
    }
  );
}

export { bootBootstrapRoutes };
