import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import {
  buildTransportResponseSchema,
  withStandardErrorResponses
} from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { routeParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { resolveWorkspaceRoutePath } from "@jskit-ai/workspaces-core/server/support/workspaceRoutePaths";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/workspaces-core/server/support/workspaceRouteInput";
import {
  ACTION_CURRENT,
  ACTION_START,
  ACTION_GRANT,
  ACTION_CLOSE
} from "./rewardedActions.js";
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

const REWARDED_ROUTE_SURFACE = "app";

function buildWorkflowResponses(outputValidator) {
  return withStandardErrorResponses({
    200: buildTransportResponseSchema(
      outputValidator.schema.toJsonSchema({
        mode: outputValidator.mode
      })
    )
  }, {
    includeValidation400: true
  });
}

/**
 * Registers the Rewarded gate routes: the app surface's workspace routes under `rewarded`, for the
 * workspace's signed-in user.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router
 */
function registerRewardedRoutes(router) {
  const routeBase = resolveWorkspaceRoutePath("rewarded");
  const visibility = checkRouteVisibility("workspace_user");

  router.register(
    "GET",
    `${routeBase}/current`,
    {
      auth: "required",
      surface: REWARDED_ROUTE_SURFACE,
      visibility,
      params: routeParamsValidator,
      query: currentQueryInputValidator,
      responses: buildWorkflowResponses(currentStateOutputValidator),
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
      surface: REWARDED_ROUTE_SURFACE,
      visibility,
      params: routeParamsValidator,
      body: startCommandInputValidator,
      responses: buildWorkflowResponses(startGateOutputValidator),
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
      surface: REWARDED_ROUTE_SURFACE,
      visibility,
      params: routeParamsValidator,
      body: grantCommandInputValidator,
      responses: buildWorkflowResponses(grantRewardOutputValidator),
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
      surface: REWARDED_ROUTE_SURFACE,
      visibility,
      params: routeParamsValidator,
      body: closeCommandInputValidator,
      responses: buildWorkflowResponses(closeSessionOutputValidator),
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

export { registerRewardedRoutes };
