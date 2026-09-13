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
  router,
  {
    routeOwnershipFilter = "workspace_user",
    routeSurface = "app",
    routeRelativePath = "rewarded"
  } = {}
) {
  if (!router || typeof router.register !== "function") {
    throw new Error("registerRoutes requires an HTTP router.");
  }
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
        tags: ["rewarded"],
        summary: "Read the current Rewarded gate state."
      }
    },
    async function rewardedCurrentRoute(request, reply) {
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
        tags: ["rewarded"],
        summary: "Start a Rewarded watch session."
      }
    },
    async function rewardedStartRoute(request, reply) {
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
        tags: ["rewarded"],
        summary: "Grant a Rewarded unlock after a rewarded ad completes."
      }
    },
    async function rewardedGrantRoute(request, reply) {
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
        tags: ["rewarded"],
        summary: "Close a Rewarded watch session without granting a reward."
      }
    },
    async function rewardedCloseRoute(request, reply) {
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
