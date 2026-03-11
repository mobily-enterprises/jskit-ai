import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createRepository as createCompleteCalendarRepository } from "./completeCalendarRepository.js";
import { createService as createCompleteCalendarService } from "./completeCalendarService.js";
import { completeCalendarActions } from "./completeCalendarActions.js";

const COMPLETE_CALENDAR_ACTIONS_TOKEN = "calendar.completeCalendar.actionDefinitions";
const COMPLETE_CALENDAR_REPOSITORY_TOKEN = "calendar.completeCalendar.repository";
const COMPLETE_CALENDAR_SERVICE_TOKEN = "calendar.completeCalendar.service";

function registerCompleteCalendar(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerCompleteCalendar requires application singleton().");
  }

  app.singleton(COMPLETE_CALENDAR_REPOSITORY_TOKEN, (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    return createCompleteCalendarRepository(knex);
  });

  app.singleton(COMPLETE_CALENDAR_SERVICE_TOKEN, (scope) => {
    return createCompleteCalendarService({
      completeCalendarRepository: scope.make(COMPLETE_CALENDAR_REPOSITORY_TOKEN)
    });
  });

  registerActionDefinitions(app, COMPLETE_CALENDAR_ACTIONS_TOKEN, {
    contributorId: "calendar.completeCalendar",
    domain: "completeCalendar",
    dependencies: {
      completeCalendarService: COMPLETE_CALENDAR_SERVICE_TOKEN
    },
    actions: completeCalendarActions
  });
}

export { registerCompleteCalendar };
