import { requireAuthenticated } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { completeCalendarInputValidators } from "./completeCalendarInputValidators.js";
import { completeCalendarResource } from "../../shared/completeCalendar/completeCalendarResource.js";

const completeCalendarActions = Object.freeze([
  {
    id: "completeCalendar.week.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    inputValidator: [completeCalendarInputValidators.workspaceParamsValidator, completeCalendarInputValidators.weekQueryValidator],
    outputValidator: completeCalendarResource.operations.list.outputValidator,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "completeCalendar.week.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.completeCalendarService.listWeek(input, {
        visibilityContext: context?.visibilityContext
      });
    }
  },
  {
    id: "completeCalendar.view",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    inputValidator: completeCalendarInputValidators.routeParamsValidator,
    outputValidator: completeCalendarResource.operations.view.outputValidator,
    permission: requireAuthenticated,
    idempotency: "none",
    audit: {
      actionName: "completeCalendar.view"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.completeCalendarService.getEvent(input.eventId, {
        visibilityContext: context?.visibilityContext
      });
    }
  },
  {
    id: "completeCalendar.create",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    inputValidator: [completeCalendarInputValidators.workspaceParamsValidator, completeCalendarResource.operations.create.bodyValidator],
    outputValidator: completeCalendarResource.operations.create.outputValidator,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "completeCalendar.create"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.completeCalendarService.createEvent(input, {
        visibilityContext: context?.visibilityContext
      });
    }
  },
  {
    id: "completeCalendar.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    inputValidator: [completeCalendarInputValidators.routeParamsValidator, completeCalendarResource.operations.patch.bodyValidator],
    outputValidator: completeCalendarResource.operations.patch.outputValidator,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "completeCalendar.update"
    },
    observability: {},
    async execute(input, context, deps) {
      const { eventId, ...patch } = input;
      return deps.completeCalendarService.updateEvent(eventId, patch, {
        visibilityContext: context?.visibilityContext
      });
    }
  },
  {
    id: "completeCalendar.delete",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["admin"],
    consoleUsersOnly: false,
    inputValidator: completeCalendarInputValidators.routeParamsValidator,
    outputValidator: completeCalendarResource.operations.delete.outputValidator,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "completeCalendar.delete"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.completeCalendarService.deleteEvent(input.eventId, {
        visibilityContext: context?.visibilityContext
      });
    }
  }
]);

export { completeCalendarActions };
