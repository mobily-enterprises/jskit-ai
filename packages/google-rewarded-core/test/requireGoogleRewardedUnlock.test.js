import assert from "node:assert/strict";
import test from "node:test";

import { requireGoogleRewardedUnlock } from "../src/server/support/requireGoogleRewardedUnlock.js";

function createGoogleRewardedService(gateState) {
  const calls = [];
  return {
    calls,
    async getCurrentState(input, options = {}) {
      calls.push({
        input,
        options
      });
      return gateState;
    }
  };
}

const REQUEST_CONTEXT = Object.freeze({
  actor: {
    id: "7"
  }
});

test("requireGoogleRewardedUnlock allows an already unlocked gate", async () => {
  const gateState = {
    gateKey: "progress-logging",
    workspaceSlug: "alpha",
    surface: "app",
    enabled: true,
    available: true,
    blocked: false,
    reason: "already-unlocked",
    unlock: {
      id: "31"
    }
  };
  const googleRewardedService = createGoogleRewardedService(gateState);

  const result = await requireGoogleRewardedUnlock(
    googleRewardedService,
    {
      gateKey: "progress-logging",
      workspaceSlug: "alpha"
    },
    {
      context: REQUEST_CONTEXT
    }
  );

  assert.equal(result, gateState);
  assert.deepEqual(googleRewardedService.calls[0], {
    input: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha",
      surface: "app"
    },
    options: {
      context: REQUEST_CONTEXT
    }
  });
});

test("requireGoogleRewardedUnlock bypasses missing configuration by default", async () => {
  const gateState = {
    gateKey: "progress-logging",
    workspaceSlug: "alpha",
    surface: "app",
    enabled: false,
    available: false,
    blocked: false,
    reason: "rule-not-configured",
    unlock: null
  };
  const googleRewardedService = createGoogleRewardedService(gateState);

  const result = await requireGoogleRewardedUnlock(
    googleRewardedService,
    {
      gateKey: "progress-logging",
      workspaceSlug: "alpha"
    },
    {
      context: REQUEST_CONTEXT
    }
  );

  assert.equal(result, gateState);
});

test("requireGoogleRewardedUnlock can fail closed when configuration is required", async () => {
  const gateState = {
    gateKey: "progress-logging",
    workspaceSlug: "alpha",
    surface: "app",
    enabled: false,
    available: false,
    blocked: false,
    reason: "provider-not-configured",
    unlock: null
  };
  const googleRewardedService = createGoogleRewardedService(gateState);

  await assert.rejects(
    () => requireGoogleRewardedUnlock(
      googleRewardedService,
      {
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      },
      {
        context: REQUEST_CONTEXT,
        requireConfigured: true
      }
    ),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "google_rewarded_not_configured");
      assert.equal(error.details.rewardedGate, gateState);
      return true;
    }
  );
});

test("requireGoogleRewardedUnlock rejects when a reward is still required", async () => {
  const gateState = {
    gateKey: "progress-logging",
    workspaceSlug: "alpha",
    surface: "app",
    enabled: true,
    available: true,
    blocked: true,
    reason: "reward-required",
    unlock: null
  };
  const googleRewardedService = createGoogleRewardedService(gateState);

  await assert.rejects(
    () => requireGoogleRewardedUnlock(
      googleRewardedService,
      {
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      },
      {
        context: REQUEST_CONTEXT,
        errorMessage: "Watch a rewarded ad before logging progress."
      }
    ),
    (error) => {
      assert.equal(error.statusCode, 423);
      assert.equal(error.code, "google_rewarded_unlock_required");
      assert.equal(error.message, "Watch a rewarded ad before logging progress.");
      assert.equal(error.details.rewardedGate, gateState);
      return true;
    }
  );
});

test("requireGoogleRewardedUnlock rejects cooldown and daily-limit states", async () => {
  const cooldownService = createGoogleRewardedService({
    gateKey: "progress-logging",
    workspaceSlug: "alpha",
    surface: "app",
    enabled: true,
    available: false,
    blocked: false,
    reason: "cooldown-active",
    unlock: null
  });
  const dailyLimitService = createGoogleRewardedService({
    gateKey: "progress-logging",
    workspaceSlug: "alpha",
    surface: "app",
    enabled: true,
    available: false,
    blocked: false,
    reason: "daily-limit-reached",
    unlock: null
  });

  await assert.rejects(
    () => requireGoogleRewardedUnlock(
      cooldownService,
      {
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      },
      {
        context: REQUEST_CONTEXT
      }
    ),
    (error) => {
      assert.equal(error.statusCode, 423);
      assert.equal(error.code, "google_rewarded_cooldown_active");
      return true;
    }
  );

  await assert.rejects(
    () => requireGoogleRewardedUnlock(
      dailyLimitService,
      {
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      },
      {
        context: REQUEST_CONTEXT
      }
    ),
    (error) => {
      assert.equal(error.statusCode, 423);
      assert.equal(error.code, "google_rewarded_daily_limit_reached");
      return true;
    }
  );
});

test("requireGoogleRewardedUnlock fails closed when the rewarded service returns an invalid gate state", async () => {
  const googleRewardedService = createGoogleRewardedService({
    gateKey: "progress-logging",
    workspaceSlug: "alpha"
  });

  await assert.rejects(
    () => requireGoogleRewardedUnlock(
      googleRewardedService,
      {
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      },
      {
        context: REQUEST_CONTEXT
      }
    ),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "google_rewarded_gate_state_invalid");
      assert.deepEqual(error.details.rewardedGate, {
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      });
      return true;
    }
  );
});

test("requireGoogleRewardedUnlock fails closed when a non-blocking gate state has no explicit reason", async () => {
  const googleRewardedService = createGoogleRewardedService({
    gateKey: "progress-logging",
    workspaceSlug: "alpha",
    enabled: false,
    blocked: false
  });

  await assert.rejects(
    () => requireGoogleRewardedUnlock(
      googleRewardedService,
      {
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      },
      {
        context: REQUEST_CONTEXT
      }
    ),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "google_rewarded_gate_state_invalid");
      return true;
    }
  );
});
