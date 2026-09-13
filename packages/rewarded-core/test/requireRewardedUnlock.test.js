import assert from "node:assert/strict";
import test from "node:test";

import { requireRewardedUnlock } from "../src/server/support/requireRewardedUnlock.js";

function createRewardedService(gateState) {
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

test("requireRewardedUnlock allows an already unlocked gate", async () => {
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
  const rewardedService = createRewardedService(gateState);

  const result = await requireRewardedUnlock(
    rewardedService,
    {
      gateKey: "progress-logging",
      workspaceSlug: "alpha"
    },
    {
      context: REQUEST_CONTEXT
    }
  );

  assert.equal(result, gateState);
  assert.deepEqual(rewardedService.calls[0], {
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

test("requireRewardedUnlock bypasses missing configuration by default", async () => {
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
  const rewardedService = createRewardedService(gateState);

  const result = await requireRewardedUnlock(
    rewardedService,
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

test("requireRewardedUnlock can fail closed when configuration is required", async () => {
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
  const rewardedService = createRewardedService(gateState);

  await assert.rejects(
    () => requireRewardedUnlock(
      rewardedService,
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
      assert.equal(error.code, "rewarded_not_configured");
      assert.equal(error.details.rewardedGate, gateState);
      return true;
    }
  );
});

test("requireRewardedUnlock rejects when a reward is still required", async () => {
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
  const rewardedService = createRewardedService(gateState);

  await assert.rejects(
    () => requireRewardedUnlock(
      rewardedService,
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
      assert.equal(error.code, "rewarded_unlock_required");
      assert.equal(error.message, "Watch a rewarded ad before logging progress.");
      assert.equal(error.details.rewardedGate, gateState);
      return true;
    }
  );
});

test("requireRewardedUnlock rejects cooldown and daily-limit states", async () => {
  const cooldownService = createRewardedService({
    gateKey: "progress-logging",
    workspaceSlug: "alpha",
    surface: "app",
    enabled: true,
    available: false,
    blocked: false,
    reason: "cooldown-active",
    unlock: null
  });
  const dailyLimitService = createRewardedService({
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
    () => requireRewardedUnlock(
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
      assert.equal(error.code, "rewarded_cooldown_active");
      return true;
    }
  );

  await assert.rejects(
    () => requireRewardedUnlock(
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
      assert.equal(error.code, "rewarded_daily_limit_reached");
      return true;
    }
  );
});

test("requireRewardedUnlock fails closed when the rewarded service returns an invalid gate state", async () => {
  const rewardedService = createRewardedService({
    gateKey: "progress-logging",
    workspaceSlug: "alpha"
  });

  await assert.rejects(
    () => requireRewardedUnlock(
      rewardedService,
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
      assert.equal(error.code, "rewarded_gate_state_invalid");
      assert.deepEqual(error.details.rewardedGate, {
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      });
      return true;
    }
  );
});

test("requireRewardedUnlock fails closed when a non-blocking gate state has no explicit reason", async () => {
  const rewardedService = createRewardedService({
    gateKey: "progress-logging",
    workspaceSlug: "alpha",
    enabled: false,
    blocked: false
  });

  await assert.rejects(
    () => requireRewardedUnlock(
      rewardedService,
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
      assert.equal(error.code, "rewarded_gate_state_invalid");
      return true;
    }
  );
});
