import { ensureNonEmptyText, normalizeObject } from "@jskit-ai/support-core/normalize";
import { sortById } from "@jskit-ai/support-core/sorting";
import { ScheduleRegistrationError } from "./errors.js";

class ScheduleRegistry {
  constructor() {
    this.schedules = new Map();
  }

  register(definition = {}) {
    const source = normalizeObject(definition);
    const id = ensureNonEmptyText(source.id, "schedule id");
    const cron = ensureNonEmptyText(source.cron, `schedule ${id} cron`);

    if (this.schedules.has(id)) {
      throw new ScheduleRegistrationError(`Schedule \"${id}\" is already registered.`);
    }
    if (typeof source.run !== "function") {
      throw new ScheduleRegistrationError(`Schedule \"${id}\" run must be a function.`);
    }

    this.schedules.set(
      id,
      Object.freeze({
        id,
        cron,
        run: source.run
      })
    );

    return this;
  }

  list() {
    return Object.freeze(sortById([...this.schedules.values()]));
  }
}

function createScheduleRegistry() {
  return new ScheduleRegistry();
}

export { ScheduleRegistry, createScheduleRegistry };
