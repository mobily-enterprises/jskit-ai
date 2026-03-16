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
    permission: {
      require: "authenticated"
    },
    inputValidator: [completeCalendarInputValidators.workspaceParamsValidator, completeCalendarInputValidators.weekQueryValidator],
    outputValidator: completeCalendarResource.operations.list.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "completeCalendar.week.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.completeCalendarService.listWeek(input, {
        context,
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
    permission: {
      require: "authenticated"
    },
    inputValidator: completeCalendarInputValidators.routeParamsValidator,
    outputValidator: completeCalendarResource.operations.view.outputValidator,
    idempotency: "none",
    audit: {
      actionName: "completeCalendar.view"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.completeCalendarService.getEvent(input.eventId, {
        context,
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
    permission: {
      require: "authenticated"
    },
    inputValidator: [completeCalendarInputValidators.workspaceParamsValidator, completeCalendarResource.operations.create.bodyValidator],
    outputValidator: completeCalendarResource.operations.create.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: "completeCalendar.create"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.completeCalendarService.createEvent(input, {
        context,
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
    permission: {
      require: "authenticated"
    },
    inputValidator: [completeCalendarInputValidators.routeParamsValidator, completeCalendarResource.operations.patch.bodyValidator],
    outputValidator: completeCalendarResource.operations.patch.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: "completeCalendar.update"
    },
    observability: {},
    async execute(input, context, deps) {
      const { eventId, ...patch } = input;
      return deps.completeCalendarService.updateEvent(eventId, patch, {
        context,
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
    permission: {
      require: "authenticated"
    },
    inputValidator: completeCalendarInputValidators.routeParamsValidator,
    outputValidator: completeCalendarResource.operations.delete.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: "completeCalendar.delete"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.completeCalendarService.deleteEvent(input.eventId, {
        context,
        visibilityContext: context?.visibilityContext
      });
    }
  }
]);

export { completeCalendarActions };
