import { withStandardErrorResponses } from "../../api/schema.js";

function buildRoutes(controllers, { missingHandler, schema }) {
  return [
    {
      path: "/api/bootstrap",
      method: "GET",
      auth: "public",
      schema: {
        tags: ["workspace"],
        summary: "Get startup bootstrap payload with session, app, workspace, and settings context",
        response: withStandardErrorResponses({
          200: schema.response.bootstrap
        })
      },
      handler: controllers.workspace?.bootstrap || missingHandler
    }
  ];
}

export { buildRoutes };
