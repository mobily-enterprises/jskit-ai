import { actionIds } from "./actionIds.js";
import {
  statusQueryInputValidator,
  executeCommandInputValidator
} from "./inputSchemas.js";

const featureActions = Object.freeze([
  {
    id: actionIds.getStatus,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
__JSKIT_FEATURE_ACTION_SURFACES_LINE__
    input: statusQueryInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: actionIds.getStatus
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.featureService.getStatus(input, {
        context
      });
    }
  },
  {
    id: actionIds.execute,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
__JSKIT_FEATURE_ACTION_SURFACES_LINE__
    input: executeCommandInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: actionIds.execute
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.featureService.execute(input, {
        context
      });
    }
  }
]);

export { featureActions };
