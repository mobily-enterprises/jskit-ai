import { defineProvider } from "../../shared/capabilities/defineProvider.js";
import { createActionCatalogue } from "./actionCatalogue.js";

const ActionProvider = defineProvider({
  id: "runtime.actions",
  requires: {
    events: "runtime.events",
    logger: "runtime.logger"
  },
  provides: {
    actions: "runtime.actions"
  },
  /**
   * @param {object} dependencies
   * @param {import("../types.js").RuntimeEvents} dependencies.events
   * @param {import("../types.js").RuntimeLogger} dependencies.logger
   */
  setup({ events, logger }) {
    return { actions: createActionCatalogue({ events, logger }) };
  }
});

export { ActionProvider };
