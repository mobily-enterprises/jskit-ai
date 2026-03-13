import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { createRepository as createCompleteCalendarRepository } from "./completeCalendarRepository.js";
import { createService as createCompleteCalendarService } from "./completeCalendarService.js";
import { completeCalendarActions } from "./completeCalendarActions.js";
import { resolveCalendarContactsCrudConfig } from "../../shared/completeCalendar/completeCalendarCrudConfig.js";

const COMPLETE_CALENDAR_REPOSITORY_TOKEN = "calendar.completeCalendar.repository";
const COMPLETE_CALENDAR_SERVICE_TOKEN = "calendar.completeCalendar.service";

function registerCompleteCalendar(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerCompleteCalendar requires application singleton()/actions().");
  }

  app.singleton(COMPLETE_CALENDAR_REPOSITORY_TOKEN, (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    const contactsCrudConfig = resolveCalendarContactsCrudConfig(appConfig);
    return createCompleteCalendarRepository(knex, {
      contactsTableName: contactsCrudConfig.tableName
    });
  });

  app.singleton(COMPLETE_CALENDAR_SERVICE_TOKEN, (scope) => {
    return createCompleteCalendarService({
      completeCalendarRepository: scope.make(COMPLETE_CALENDAR_REPOSITORY_TOKEN)
    });
  });

  app.actions({
    contributorId: "calendar.completeCalendar",
    domain: "completeCalendar",
    dependencies: {
      completeCalendarService: COMPLETE_CALENDAR_SERVICE_TOKEN
    },
    actions: completeCalendarActions
  });
}

export { registerCompleteCalendar };
