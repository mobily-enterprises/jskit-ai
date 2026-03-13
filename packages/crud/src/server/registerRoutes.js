import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  cursorPaginationQueryValidator,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { routeParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { createActionIds } from "./actionIds.js";
import { crudResource } from "../shared/crud/crudResource.js";

function joinRoutePath(basePath = "", suffix = "") {
  const base = String(basePath || "").trim().replace(/\/+$/g, "");
  const end = String(suffix || "").trim();
  if (!end) {
    return base;
  }

  return `${base}/${end.replace(/^\/+/, "")}`;
}

function registerRoutes(
  app,
  {
    routeBasePath = "/api/w/:workspaceSlug/workspace/crud",
    routeVisibility = "workspace",
    actionIds = createActionIds()
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const routeBase = String(routeBasePath || "").trim() || "/api/w/:workspaceSlug/workspace/crud";
  const visibility = String(routeVisibility || "").trim() || "workspace";

  router.register(
    "GET",
    routeBase,
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["crud"],
        summary: "List records."
      },
      paramsValidator: routeParamsValidator,
      queryValidator: cursorPaginationQueryValidator,
      responseValidators: withStandardErrorResponses({
        200: crudResource.operations.list.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.list,
        context: { surface: "admin" },
        input: {
          ...request.input.params,
          ...request.input.query
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    joinRoutePath(routeBase, ":recordId"),
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["crud"],
        summary: "View a record."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      responseValidators: withStandardErrorResponses({
        200: crudResource.operations.view.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.view,
        context: { surface: "admin" },
        input: request.input.params
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    routeBase,
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["crud"],
        summary: "Create a record."
      },
      paramsValidator: routeParamsValidator,
      bodyValidator: crudResource.operations.create.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          201: crudResource.operations.create.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.create,
        context: { surface: "admin" },
        input: {
          ...request.input.params,
          ...request.input.body
        }
      });
      reply.code(201).send(response);
    }
  );

  router.register(
    "PATCH",
    joinRoutePath(routeBase, ":recordId"),
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["crud"],
        summary: "Update a record."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      bodyValidator: crudResource.operations.patch.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: crudResource.operations.patch.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.update,
        context: { surface: "admin" },
        input: {
          ...request.input.params,
          ...request.input.body
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "DELETE",
    joinRoutePath(routeBase, ":recordId"),
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["crud"],
        summary: "Delete a record."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      responseValidators: withStandardErrorResponses({
        200: crudResource.operations.delete.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.delete,
        context: { surface: "admin" },
        input: request.input.params
      });
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
