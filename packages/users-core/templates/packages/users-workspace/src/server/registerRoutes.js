import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator
} from "@jskit-ai/crud-core/server/listQueryValidators";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { recordIdParamsValidator } from "@jskit-ai/kernel/shared/validators";
import { routeParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/workspaces-core/server/support/workspaceRouteInput";
import { actionIds } from "./actionIds.js";
import { LIST_CONFIG } from "./listConfig.js";
import { resource } from "../shared/userResource.js";

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator(LIST_CONFIG);

function registerRoutes(
  app,
  {
    routeOwnershipFilter = "public",
    routeSurface = "",
    routeSurfaceRequiresWorkspace = false,
    routeRelativePath = ""
  } = {}
) {
  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: routeSurfaceRequiresWorkspace === true ? "/w/:workspaceSlug" : "/",
    relativePath: routeRelativePath,
    strictParams: false
  });

  router.register(
    "GET",
    routeBase,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "List users."
      },
      paramsValidator: routeParamsValidator,
      queryValidator: [listCursorPaginationQueryValidator, listSearchQueryValidator],
      responseValidators: withStandardErrorResponses({
        200: resource.operations.list.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.list,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          ...(request.input.query || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/:recordId`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "View a user."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      responseValidators: withStandardErrorResponses({
        200: resource.operations.view.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.view,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          recordId: request.input.params.recordId
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
