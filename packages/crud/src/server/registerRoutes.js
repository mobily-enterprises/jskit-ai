import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { inputPartsValidator } from "./inputPartsValidator.js";
import { createActionIds } from "./actions.js";
import { contactsResource } from "../shared/contacts/contactsResource.js";

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
      params: inputPartsValidator.workspaceParams,
      query: inputPartsValidator.listQuery,
      response: withStandardErrorResponses({
        200: contactsResource.operations.list.output
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
    joinRoutePath(routeBase, ":contactId"),
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["crud"],
        summary: "View a record."
      },
      params: inputPartsValidator.routeParams,
      response: withStandardErrorResponses({
        200: contactsResource.operations.view.output
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
      params: inputPartsValidator.workspaceParams,
      body: contactsResource.operations.create.body,
      response: withStandardErrorResponses(
        {
          201: contactsResource.operations.create.output
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
    joinRoutePath(routeBase, ":contactId"),
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["crud"],
        summary: "Update a record."
      },
      params: inputPartsValidator.routeParams,
      body: contactsResource.operations.patch.body,
      response: withStandardErrorResponses(
        {
          200: contactsResource.operations.patch.output
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
    joinRoutePath(routeBase, ":contactId"),
    {
      auth: "required",
      visibility,
      meta: {
        tags: ["crud"],
        summary: "Delete a record."
      },
      params: inputPartsValidator.routeParams,
      response: withStandardErrorResponses({
        200: contactsResource.operations.delete.output
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
