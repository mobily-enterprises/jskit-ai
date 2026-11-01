import { defineProvider } from "../../shared/capabilities/defineProvider.js";
import { createActionCatalogue } from "./actionCatalogue.js";
import { noActionPolicy } from "./actionPolicy.js";

const ActionProvider = defineProvider({
  id: "runtime.actions",
  requires: {
    events: "runtime.events",
    logger: "runtime.logger"
  },
  optional: {
    policy: "runtime.actions.policy"
  },
  provides: {
    actions: "runtime.actions"
  },
  /**
   * @param {object} dependencies
   * @param {import("../types.js").RuntimeEvents} dependencies.events
   * @param {import("../types.js").RuntimeLogger} dependencies.logger
   * @param {import("../types.js").ActionPolicy | null} dependencies.policy
   */
  setup({ events, logger, policy }) {
    return { actions: createActionCatalogue({ events, logger, policy: policy ?? noActionPolicy }) };
  }
});

export { ActionProvider };
