import {
  statusQueryInputValidator,
  executeCommandInputValidator
} from "./inputSchemas.js";

const ACTION_GET_STATUS = "feature.${option:feature-name|kebab}.status.read";
const ACTION_EXECUTE = "feature.${option:feature-name|kebab}.execute";

const featureActions = Object.freeze([
  {
    id: ACTION_GET_STATUS,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
__JSKIT_FEATURE_ACTION_SURFACES_LINE__
    input: statusQueryInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_GET_STATUS
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.featureService.getStatus(input, {
        context
      });
    }
  },
  {
    id: ACTION_EXECUTE,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
__JSKIT_FEATURE_ACTION_SURFACES_LINE__
    input: executeCommandInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_EXECUTE
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
