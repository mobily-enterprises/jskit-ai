import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const GOOGLE_REWARDED_SURFACE = "app";

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
    code: "google_rewarded_unlock_required",
    message: "Rewarded unlock required."
  },
  "cooldown-active": {
    status: 423,
    code: "google_rewarded_cooldown_active",
    message: "Rewarded unlock is cooling down."
  },
  "daily-limit-reached": {
    status: 423,
    code: "google_rewarded_daily_limit_reached",
    message: "Rewarded unlock limit reached."
  },
  "rule-not-configured": {
    status: 503,
    code: "google_rewarded_not_configured",
    message: "Rewarded gate is not configured."
  },
  "provider-not-configured": {
    status: 503,
    code: "google_rewarded_not_configured",
    message: "Rewarded gate is not configured."
  }
});

function normalizeReason(value = "") {
  return normalizeText(value).toLowerCase();
}

function isUnlockSatisfied(gateState = null) {
  const reason = normalizeReason(gateState?.reason);
  return Boolean(gateState?.unlock) || reason === "already-unlocked";
}

function hasBooleanGateFlag(gateState, key) {
  return gateState && typeof gateState === "object" && typeof gateState[key] === "boolean";
}

function assertWellFormedGateState(gateState = null) {
  if (hasBooleanGateFlag(gateState, "enabled") && hasBooleanGateFlag(gateState, "blocked")) {
    if (
      gateState.blocked === true ||
      isUnlockSatisfied(gateState) ||
      REWARDED_GATE_NON_BLOCKING_REASONS.has(normalizeReason(gateState?.reason))
    ) {
      return;
    }
  }

  throw new AppError(503, "Rewarded gate returned an invalid state.", {
    code: "google_rewarded_gate_state_invalid",
    details: {
      rewardedGate: gateState
    }
  });
}

function isConfigurationBypassAllowed(gateState = null, requireConfigured = false) {
  if (requireConfigured === true) {
    return false;
  }

  if (gateState?.enabled === true) {
    return false;
  }

  const reason = normalizeReason(gateState?.reason);
  return REWARDED_GATE_CONFIGURATION_REASONS.has(reason) || !reason;
}

function createRewardedGateError(gateState = null, {
  errorCode = "",
  errorMessage = ""
} = {}) {
  const reason = normalizeReason(gateState?.reason);
  const defaults = REWARDED_GATE_REASON_ERROR_MAP[reason] || {
    status: 423,
    code: "google_rewarded_unlock_blocked",
    message: "Rewarded unlock is required before this action can continue."
  };

  return new AppError(defaults.status, errorMessage || defaults.message, {
    code: errorCode || defaults.code,
    details: {
      rewardedGate: gateState
    }
  });
}

async function requireGoogleRewardedUnlock(googleRewardedService, input = {}, {
  context = null,
  requireConfigured = false,
  errorCode = "",
  errorMessage = ""
} = {}) {
  if (!googleRewardedService || typeof googleRewardedService.getCurrentState !== "function") {
    throw new TypeError("requireGoogleRewardedUnlock requires googleRewardedService.getCurrentState().");
  }

  const gateState = await googleRewardedService.getCurrentState(
    {
      ...input,
      surface: GOOGLE_REWARDED_SURFACE
    },
    {
      context
    }
  );
  assertWellFormedGateState(gateState);

  if (isUnlockSatisfied(gateState) || isConfigurationBypassAllowed(gateState, requireConfigured)) {
    return gateState;
  }

  throw createRewardedGateError(gateState, {
    errorCode,
    errorMessage
  });
}

export {
  requireGoogleRewardedUnlock
};
