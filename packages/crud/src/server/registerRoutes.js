import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  cursorPaginationQueryValidator,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { routeParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { crudResource } from "../shared/crud/crudResource.js";

function joinRoutePath(basePath = "", suffix = "") {
  const base = String(basePath || "").trim().replace(/\/+$/g, "");
  const end = String(suffix || "").trim();
  if (!end) {
    return base;
  }

  return `${base}/${end.replace(/^\/+/, "")}`;
}

function requireRouteBasePath(routeBasePath) {
  const routeBase = String(routeBasePath || "").trim();
  if (!routeBase) {
    throw new TypeError("registerRoutes requires routeBasePath.");
  }

  return routeBase;
}

function requireActionIds(actionIds) {
  const source = actionIds && typeof actionIds === "object" && !Array.isArray(actionIds) ? actionIds : null;
  if (!source) {
    throw new TypeError("registerRoutes requires actionIds.");
  }

  const requiredKeys = ["list", "view", "create", "update", "delete"];
  const normalized = {};
  for (const key of requiredKeys) {
    const value = String(source[key] || "").trim();
    if (!value) {
      throw new TypeError(`registerRoutes requires actionIds.${key}.`);
    }
    normalized[key] = value;
  }

  return Object.freeze(normalized);
}

function registerRoutes(
  app,
  {
    routeBasePath,
    routeVisibility = "workspace",
    actionIds
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const routeBase = requireRouteBasePath(routeBasePath);
  const visibility = String(routeVisibility || "").trim() || "workspace";
  const resolvedActionIds = requireActionIds(actionIds);

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
      const listInput = {
        workspaceSlug: request.input.params.workspaceSlug
      };
      if (request.input.query.cursor != null) {
        listInput.cursor = request.input.query.cursor;
      }
      if (request.input.query.limit != null) {
        listInput.limit = request.input.query.limit;
      }
      const response = await request.executeAction({
        actionId: resolvedActionIds.list,
        context: { surface: "admin" },
        input: listInput
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
        actionId: resolvedActionIds.view,
        context: { surface: "admin" },
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          recordId: request.input.params.recordId
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
        actionId: resolvedActionIds.create,
        context: { surface: "admin" },
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
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
        actionId: resolvedActionIds.update,
        context: { surface: "admin" },
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          recordId: request.input.params.recordId,
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
        actionId: resolvedActionIds.delete,
        context: { surface: "admin" },
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          recordId: request.input.params.recordId
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
