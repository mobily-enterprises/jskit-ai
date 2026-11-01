import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const REWARDED_GATE_CONFIGURATION_REASONS = new Set([
  "rule-not-configured",
  "provider-not-configured"
]);
const REWARDED_GATE_NON_BLOCKING_REASONS = new Set([
  "already-unlocked",
  "cooldown-active",
  "daily-limit-reached",
  ...REWARDED_GATE_CONFIGURATION_REASONS
]);

const REWARDED_GATE_REASON_ERROR_MAP = Object.freeze({
  "reward-required": {
    status: 423,
    code: "rewarded_unlock_required",
    message: "Rewarded unlock required."
  },
  "cooldown-active": {
    status: 423,
    code: "rewarded_cooldown_active",
    message: "Rewarded unlock is cooling down."
  },
  "daily-limit-reached": {
    status: 423,
    code: "rewarded_daily_limit_reached",
    message: "Rewarded unlock limit reached."
  },
  "rule-not-configured": {
    status: 503,
    code: "rewarded_not_configured",
    message: "Rewarded gate is not configured."
  },
  "provider-not-configured": {
    status: 503,
    code: "rewarded_not_configured",
    message: "Rewarded gate is not configured."
  }
});

function normalizeReason(value) {
  return normalizeText(value).toLowerCase();
}

function isUnlockSatisfied(gateState) {
  return Boolean(gateState.unlock) || normalizeReason(gateState.reason) === "already-unlocked";
}

function hasBooleanGateFlag(gateState, key) {
  return gateState && typeof gateState === "object" && typeof gateState[key] === "boolean";
}

/**
 * Refuses a gate state that is not an object with boolean enabled and blocked
 * flags and a blocking, unlocked or known non-blocking reason.
 * @param {unknown} gateState What the Rewarded service answered.
 */
function assertWellFormedGateState(gateState) {
  if (hasBooleanGateFlag(gateState, "enabled") && hasBooleanGateFlag(gateState, "blocked")) {
    if (
      gateState.blocked === true ||
      isUnlockSatisfied(gateState) ||
      REWARDED_GATE_NON_BLOCKING_REASONS.has(normalizeReason(gateState.reason))
    ) {
      return;
    }
  }

  throw new AppError(503, "Rewarded gate returned an invalid state.", {
    code: "rewarded_gate_state_invalid",
    details: {
      rewardedGate: gateState
    }
  });
}

function isConfigurationBypassAllowed(gateState, requireConfigured) {
  if (requireConfigured === true) {
    return false;
  }

  if (gateState.enabled === true) {
    return false;
  }

  const reason = normalizeReason(gateState.reason);
  return REWARDED_GATE_CONFIGURATION_REASONS.has(reason) || !reason;
}

function buildRewardedGateError(gateState, { errorCode, errorMessage }) {
  const reason = normalizeReason(gateState.reason);
  const defaults = REWARDED_GATE_REASON_ERROR_MAP[reason] || {
    status: 423,
    code: "rewarded_unlock_blocked",
    message: "Rewarded unlock is required before this action can continue."
  };

  return new AppError(defaults.status, errorMessage || defaults.message, {
    code: errorCode || defaults.code,
    details: {
      rewardedGate: gateState
    }
  });
}

/**
 * Answers the gate's current state when it is unlocked (or, unless
 * requireConfigured, not configured); otherwise throws the gate's error.
 * @param {import("../types.js").RewardedCore} rewardedService
 * @param {object} [input] The gate to check: its gateKey and workspaceSlug.
 * @param {object} [options]
 * @param {object | null} [options.context]
 * @param {boolean} [options.requireConfigured]
 * @param {string} [options.errorCode]
 * @param {string} [options.errorMessage]
 */
async function requireRewardedUnlock(rewardedService, input = {}, {
  context = null,
  requireConfigured = false,
  errorCode = "",
  errorMessage = ""
} = {}) {
  const gateState = await rewardedService.getCurrentState(input, { context });
  assertWellFormedGateState(gateState);

  if (isUnlockSatisfied(gateState) || isConfigurationBypassAllowed(gateState, requireConfigured)) {
    return gateState;
  }

  throw buildRewardedGateError(gateState, {
    errorCode,
    errorMessage
  });
}

export {
  requireRewardedUnlock
};
