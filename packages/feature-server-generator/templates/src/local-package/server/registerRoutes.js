import { resolveScopedApiBasePath__JSKIT_FEATURE_ROUTE_SURFACE_IMPORT__ } from "@jskit-ai/kernel/shared/surface";
import { actionIds } from "./actionIds.js";
import {
  statusQueryInputValidator,
  executeCommandInputValidator
} from "./inputSchemas.js";

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");
__JSKIT_FEATURE_ROUTE_SURFACE_NORMALIZER_LINE__
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/",
    relativePath: routeRelativePath,
    strictParams: false
  });

  router.register(
    "GET",
    routeBase,
    {
      auth: "public",
__JSKIT_FEATURE_ROUTE_SURFACE_LINE__
      meta: {
        tags: ["feature"],
        summary: "Read feature status."
      },
      query: statusQueryInputValidator
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.getStatus,
        input: request.input.query || {}
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    routeBase,
    {
      auth: "public",
__JSKIT_FEATURE_ROUTE_SURFACE_LINE__
      meta: {
        tags: ["feature"],
        summary: "Execute feature command."
      },
      body: executeCommandInputValidator
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.execute,
        input: request.input.body || {}
      });

      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
