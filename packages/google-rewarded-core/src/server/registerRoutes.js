import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import {
  createTransportResponseSchema,
  withStandardErrorResponses
} from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { routeParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/workspaces-core/server/support/workspaceRouteInput";
import {
  ACTION_CURRENT,
  ACTION_START,
  ACTION_GRANT,
  ACTION_CLOSE
} from "./actions.js";
import {
  currentQueryInputValidator,
  startCommandInputValidator,
  grantCommandInputValidator,
  closeCommandInputValidator,
  currentStateOutputValidator,
  startGateOutputValidator,
  grantRewardOutputValidator,
  closeSessionOutputValidator
} from "./inputSchemas.js";

function createWorkflowResponses(outputValidator) {
  return withStandardErrorResponses({
    200: createTransportResponseSchema(
      outputValidator.schema.toJsonSchema({
        mode: outputValidator.mode
      })
    )
  }, {
    includeValidation400: true
  });
}

function registerRoutes(
  app,
  {
    routeOwnershipFilter = "workspace_user",
    routeSurface = "app",
    routeRelativePath = "google-rewarded"
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/w/:workspaceSlug",
    relativePath: routeRelativePath,
    strictParams: false
  });
  const visibility = checkRouteVisibility(routeOwnershipFilter);

  router.register(
    "GET",
    `${routeBase}/current`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility,
      params: routeParamsValidator,
      query: currentQueryInputValidator,
      responses: createWorkflowResponses(currentStateOutputValidator),
      meta: {
        tags: ["google-rewarded"],
        summary: "Read the current Google rewarded gate state."
      }
    },
    async function googleRewardedCurrentRoute(request, reply) {
      const response = await request.executeAction({
        actionId: ACTION_CURRENT,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          ...(request.input.query || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/start`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility,
      params: routeParamsValidator,
      body: startCommandInputValidator,
      responses: createWorkflowResponses(startGateOutputValidator),
      meta: {
        tags: ["google-rewarded"],
        summary: "Start a Google rewarded watch session."
      }
    },
    async function googleRewardedStartRoute(request, reply) {
      const response = await request.executeAction({
        actionId: ACTION_START,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          ...(request.input.body || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/grant`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility,
      params: routeParamsValidator,
      body: grantCommandInputValidator,
      responses: createWorkflowResponses(grantRewardOutputValidator),
      meta: {
        tags: ["google-rewarded"],
        summary: "Grant a Google rewarded unlock after a rewarded ad completes."
      }
    },
    async function googleRewardedGrantRoute(request, reply) {
      const response = await request.executeAction({
        actionId: ACTION_GRANT,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          ...(request.input.body || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/close`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility,
      params: routeParamsValidator,
      body: closeCommandInputValidator,
      responses: createWorkflowResponses(closeSessionOutputValidator),
      meta: {
        tags: ["google-rewarded"],
        summary: "Close a Google rewarded watch session without granting a reward."
      }
    },
    async function googleRewardedCloseRoute(request, reply) {
      const response = await request.executeAction({
        actionId: ACTION_CLOSE,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          ...(request.input.body || {})
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
