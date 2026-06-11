import {
  currentQueryInputValidator,
  startCommandInputValidator,
  grantCommandInputValidator,
  closeCommandInputValidator,
  currentStateOutputValidator,
  startGateOutputValidator,
  grantRewardOutputValidator,
  closeSessionOutputValidator
} from "./inputSchemas.js";

const ACTION_CURRENT = "google-rewarded.current.read";
const ACTION_START = "google-rewarded.start";
const ACTION_GRANT = "google-rewarded.grant";
const ACTION_CLOSE = "google-rewarded.close";

const googleRewardedActions = Object.freeze([
  {
    id: ACTION_CURRENT,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    input: currentQueryInputValidator,
    output: currentStateOutputValidator,
    idempotency: "none",
    audit: {
      actionName: ACTION_CURRENT
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.googleRewardedService.getCurrentState(input, {
        context
      });
    }
  },
  {
    id: ACTION_START,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    input: startCommandInputValidator,
    output: startGateOutputValidator,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.googleRewardedService.startGate(input, {
        context
      });
    }
  },
  {
    id: ACTION_GRANT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    input: grantCommandInputValidator,
    output: grantRewardOutputValidator,
    idempotency: "optional",
    audit: {
      actionName: ACTION_GRANT
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.googleRewardedService.grantReward(input, {
        context
      });
    }
  },
  {
    id: ACTION_CLOSE,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    input: closeCommandInputValidator,
    output: closeSessionOutputValidator,
    idempotency: "optional",
    audit: {
      actionName: ACTION_CLOSE
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.googleRewardedService.closeSession(input, {
        context
      });
    }
  }
]);

export {
  ACTION_CURRENT,
  ACTION_START,
  ACTION_GRANT,
  ACTION_CLOSE,
  googleRewardedActions
};
