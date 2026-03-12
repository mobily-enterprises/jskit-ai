import { registerCompleteCalendar } from "./completeCalendar/registerCompleteCalendar.js";
import { registerCompleteCalendarRoutes } from "./completeCalendar/registerCompleteCalendarRoutes.js";

class CalendarServiceProvider {
  static id = "calendar.completeCalendar";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.policy.fastify", "users.core", "crud"];

  register(app) {
    registerCompleteCalendar(app);
  }

  boot(app) {
    registerCompleteCalendarRoutes(app);
  }
}

export { CalendarServiceProvider };
