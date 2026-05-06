import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { createCrudJsonApiRouteContracts } from "@jskit-ai/crud-core/server/routeContracts";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { resource } from "../../shared/googleRewardedUnlockReceiptResource.js";
import { routeParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/workspaces-core/server/support/workspaceRouteInput";

const {
  listRouteContract,
  viewRouteContract,
  createRouteContract,
  updateRouteContract,
  deleteRouteContract,
  recordRouteParamsValidator
} = createCrudJsonApiRouteContracts({
  resource,
  routeParamsValidator
});

function registerRoutes(
  app,
  {
    routeOwnershipFilter = "public",
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/w/:workspaceSlug",
    relativePath: routeRelativePath,
    strictParams: false
  });

  router.register(
    "GET",
    routeBase,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      internal: true,
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "List records."
      },
      ...listRouteContract,
      params: routeParamsValidator,
    },
    async function (request, reply) {
      const listInput = {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          ...(request.input.query || {})
      };
      const response = await request.executeAction({
        actionId: "crud.google_rewarded_unlock_receipts.list",
        input: listInput
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
      internal: true,
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "View a record."
      },
      ...viewRouteContract,
      params: recordRouteParamsValidator,
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "crud.google_rewarded_unlock_receipts.view",
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          recordId: request.input.params.recordId,
          ...(request.input.query || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    routeBase,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      internal: true,
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "Create a record."
      },
      ...createRouteContract,
      params: routeParamsValidator,
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "crud.google_rewarded_unlock_receipts.create",
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          ...(request.input.body || {})
        }
      });
      reply.code(201).send(response);
    }
  );

  router.register(
    "PATCH",
    `${routeBase}/:recordId`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      internal: true,
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "Update a record."
      },
      ...updateRouteContract,
      params: recordRouteParamsValidator,
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "crud.google_rewarded_unlock_receipts.update",
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          recordId: request.input.params.recordId,
          ...(request.input.body || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/:recordId`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      internal: true,
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "Delete a record."
      },
      ...deleteRouteContract,
      params: recordRouteParamsValidator,
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "crud.google_rewarded_unlock_receipts.delete",
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          recordId: request.input.params.recordId
        }
      });
      reply.code(204).send(response);
    }
  );
}

export { registerRoutes };
