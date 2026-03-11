import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/contracts/errorResponses";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { completeCalendarInputPartsValidator } from "./completeCalendarInputPartsValidator.js";
import { completeCalendarResource } from "../../shared/completeCalendar/completeCalendarResource.js";

function registerCompleteCalendarRoutes(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerCompleteCalendarRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);

  router.register(
    "GET",
    "/api/w/:workspaceSlug/workspace/calendar/events",
    {
      auth: "required",
      visibility: "workspace",
      meta: {
        tags: ["calendar"],
        summary: "List calendar events for the selected week."
      },
      params: completeCalendarInputPartsValidator.workspaceParams,
      query: completeCalendarInputPartsValidator.weekQuery,
      response: withStandardErrorResponses({
        200: completeCalendarResource.operations.list.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "completeCalendar.week.list",
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
    "/api/w/:workspaceSlug/workspace/calendar/events/:eventId",
    {
      auth: "required",
      visibility: "workspace",
      meta: {
        tags: ["calendar"],
        summary: "View a calendar event."
      },
      params: completeCalendarInputPartsValidator.routeParams,
      response: withStandardErrorResponses({
        200: completeCalendarResource.operations.view.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "completeCalendar.view",
        context: { surface: "admin" },
        input: request.input.params
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    "/api/w/:workspaceSlug/workspace/calendar/events",
    {
      auth: "required",
      visibility: "workspace",
      meta: {
        tags: ["calendar"],
        summary: "Create a calendar event."
      },
      params: completeCalendarInputPartsValidator.workspaceParams,
      body: completeCalendarResource.operations.create.body,
      response: withStandardErrorResponses(
        {
          201: completeCalendarResource.operations.create.output
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "completeCalendar.create",
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
    "/api/w/:workspaceSlug/workspace/calendar/events/:eventId",
    {
      auth: "required",
      visibility: "workspace",
      meta: {
        tags: ["calendar"],
        summary: "Update a calendar event."
      },
      params: completeCalendarInputPartsValidator.routeParams,
      body: completeCalendarResource.operations.patch.body,
      response: withStandardErrorResponses(
        {
          200: completeCalendarResource.operations.patch.output
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "completeCalendar.update",
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
    "/api/w/:workspaceSlug/workspace/calendar/events/:eventId",
    {
      auth: "required",
      visibility: "workspace",
      meta: {
        tags: ["calendar"],
        summary: "Delete a calendar event."
      },
      params: completeCalendarInputPartsValidator.routeParams,
      response: withStandardErrorResponses({
        200: completeCalendarResource.operations.delete.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "completeCalendar.delete",
        context: { surface: "admin" },
        input: request.input.params
      });
      reply.code(200).send(response);
    }
  );
}

export { registerCompleteCalendarRoutes };
