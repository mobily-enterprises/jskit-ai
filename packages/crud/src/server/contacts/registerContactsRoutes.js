import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { contactsInputParts } from "./contactsInputParts.js";
import { contactsResource } from "../../shared/contacts/contactsResource.js";

function registerContactsRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerContactsRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "GET",
    "/api/contacts",
    {
      auth: "required",
      meta: {
        tags: ["contacts"],
        summary: "List contacts."
      },
      query: contactsInputParts.listQuery,
      response: withStandardErrorResponses({
        200: contactsResource.operations.list.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "contacts.list",
        surface: "admin",
        input: request.input.query
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    "/api/contacts/:contactId",
    {
      auth: "required",
      meta: {
        tags: ["contacts"],
        summary: "View a contact."
      },
      params: contactsInputParts.routeParams,
      response: withStandardErrorResponses({
        200: contactsResource.operations.view.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "contacts.view",
        surface: "admin",
        input: request.input.params
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    "/api/contacts",
    {
      auth: "required",
      meta: {
        tags: ["contacts"],
        summary: "Create a contact."
      },
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
        actionId: "contacts.create",
        surface: "admin",
        input: request.input.body
      });
      reply.code(201).send(response);
    }
  );

  router.register(
    "PATCH",
    "/api/contacts/:contactId",
    {
      auth: "required",
      meta: {
        tags: ["contacts"],
        summary: "Update a contact."
      },
      params: contactsInputParts.routeParams,
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
        actionId: "contacts.update",
        surface: "admin",
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
    "/api/contacts/:contactId",
    {
      auth: "required",
      meta: {
        tags: ["contacts"],
        summary: "Delete a contact."
      },
      params: contactsInputParts.routeParams,
      response: withStandardErrorResponses({
        200: contactsResource.operations.delete.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "contacts.delete",
        surface: "admin",
        input: request.input.params
      });
      reply.code(200).send(response);
    }
  );
}

export { registerContactsRoutes };
