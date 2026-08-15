import { defineProvider } from "../../shared/capabilities/defineProvider.js";
import { createEventRuntime } from "../runtime/EventProvider.js";
import { createActionCatalogue } from "./actionCatalogue.js";

function createActionProvider(options = {}) {
  return defineProvider({
    id: "runtime.actions",
    optional: {
      events: "runtime.events"
    },
    provides: {
      actions: "runtime.actions"
    },
    setup({ events }) {
      return { actions: createActionCatalogue({
        ...options,
        events: events || createEventRuntime()
      }) };
    }
  });
}

export { createActionProvider };
