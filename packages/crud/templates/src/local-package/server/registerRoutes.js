import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { inputValidators } from "./inputValidators.js";
import { createActionIds } from "./actionIds.js";
import { crudResource } from "../shared/crudResource.js";

const CRUD_ROUTE_SEGMENT = "${option:namespace|kebab|default(crud)}";
const CRUD_ROUTE_VISIBILITY = normalizeRouteVisibility("${option:visibility}", {
  fallback: "workspace"
});
const CRUD_ROUTE_BASE_PATH = isWorkspaceVisibility(CRUD_ROUTE_VISIBILITY)
  ? `/api/w/:workspaceSlug/workspace/${CRUD_ROUTE_SEGMENT}`
  : `/api/${CRUD_ROUTE_SEGMENT}`;

function isWorkspaceVisibility(visibility) {
  return visibility === "workspace" || visibility === "workspace_user";
}

function joinRoutePath(basePath = "", suffix = "") {
  const base = String(basePath || "").trim().replace(/\/+$/g, "");
  const end = String(suffix || "").trim();
  if (!end) {
    return base;
  }

  return `${base}/${end.replace(/^\/+/, "")}`;
}

function registerRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const routeBase = CRUD_ROUTE_BASE_PATH;
  const visibility = CRUD_ROUTE_VISIBILITY;
  const actionIds = createActionIds();

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
      params: inputValidators.workspaceParamsValidator,
      query: inputValidators.listQueryValidator,
      response: withStandardErrorResponses({
        200: crudResource.operations.list.output
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
      params: [inputValidators.workspaceParamsValidator, inputValidators.recordIdParamsValidator],
      response: withStandardErrorResponses({
        200: crudResource.operations.view.output
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
      params: inputValidators.workspaceParamsValidator,
      body: crudResource.operations.create.body,
      response: withStandardErrorResponses(
        {
          201: crudResource.operations.create.output
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
      params: [inputValidators.workspaceParamsValidator, inputValidators.recordIdParamsValidator],
      body: crudResource.operations.patch.body,
      response: withStandardErrorResponses(
        {
          200: crudResource.operations.patch.output
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
      params: [inputValidators.workspaceParamsValidator, inputValidators.recordIdParamsValidator],
      response: withStandardErrorResponses({
        200: crudResource.operations.delete.output
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
