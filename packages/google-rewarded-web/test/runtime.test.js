import assert from "node:assert/strict";
import test from "node:test";

import { createGoogleRewardedRuntime } from "../src/client/runtime/googleRewardedRuntime.js";

function waitForAsyncTurn() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function createJsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type"
          ? "application/json"
          : "";
      }
    },
    async json() {
      return data;
    }
  };
}

function createFetchStub({
  currentResponse,
  startResponse,
  grantResponse,
  closeResponse
} = {}) {
  const calls = [];

  async function fetchStub(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const serializedBody = typeof options.body === "string" ? options.body : "";
    const parsedBody = serializedBody ? JSON.parse(serializedBody) : null;

    calls.push({
      url: String(url),
      method,
      body: parsedBody
    });

    if (String(url) === "/api/session") {
      return createJsonResponse({
        csrfToken: "csrf-token"
      });
    }

    if (String(url).includes("/google-rewarded/current")) {
      return createJsonResponse(currentResponse);
    }
    if (String(url).includes("/google-rewarded/start")) {
      return createJsonResponse(startResponse);
    }
    if (String(url).includes("/google-rewarded/grant")) {
      return createJsonResponse(grantResponse);
    }
    if (String(url).includes("/google-rewarded/close")) {
      return createJsonResponse(closeResponse);
    }

    throw new Error(`Unexpected fetch call: ${method} ${String(url)}`);
  }

  return {
    calls,
    fetchStub
  };
}

function installBrowserGlobals({ mode = "grant" } = {}) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;

  const listenerMap = new Map();
  const slot = {
    addService() {
      return this;
    }
  };
  const pubads = {
    addEventListener(name, handler) {
      if (!listenerMap.has(name)) {
        listenerMap.set(name, new Set());
      }
      listenerMap.get(name).add(handler);
    },
    removeEventListener(name, handler) {
      listenerMap.get(name)?.delete(handler);
    }
  };

  function emit(name, event) {
    for (const handler of listenerMap.get(name) || []) {
      handler(event);
    }
  }

  const googletag = {
    apiReady: true,
    cmd: {
      push(handler) {
        handler();
      }
    },
    enums: {
      OutOfPageFormat: {
        REWARDED: "REWARDED"
      }
    },
    pubads() {
      return pubads;
    },
    defineOutOfPageSlot() {
      return mode === "unavailable" ? null : slot;
    },
    enableServices() {},
    display() {
      emit("rewardedSlotReady", {
        slot,
        makeRewardedVisible() {}
      });

      if (mode === "grant") {
        emit("rewardedSlotGranted", {
          slot
        });
      }

      emit("rewardedSlotClosed", {
        slot
      });
    },
    destroySlots() {}
  };

  globalThis.window = {
    setTimeout,
    clearTimeout,
    googletag
  };
  globalThis.document = {};

  return {
    restore() {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
      globalThis.fetch = originalFetch;
    }
  };
}

test("google rewarded runtime resolves immediately when the gate is already unlocked", async () => {
  const originalFetch = globalThis.fetch;
  const { calls, fetchStub } = createFetchStub({
    currentResponse: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha",
      surface: "app",
      enabled: true,
      available: true,
      blocked: false,
      reason: "already-unlocked",
      rule: null,
      providerConfig: {
        id: "21",
        surface: "app",
        enabled: true,
        adUnitPath: "/123456/rewarded",
        scriptMode: "gpt_rewarded"
      },
      unlock: {
        id: "31",
        gateKey: "progress-logging",
        providerConfigId: "21",
        watchSessionId: "41",
        grantedAt: new Date().toISOString(),
        unlockedUntil: new Date(Date.now() + 60_000).toISOString()
      },
      cooldownUntil: null,
      dailyLimitRemaining: null
    }
  });
  globalThis.fetch = fetchStub;

  try {
    const runtime = createGoogleRewardedRuntime();
    const result = await runtime.requireUnlock({
      gateKey: "progress-logging",
      workspaceSlug: "alpha"
    });

    assert.equal(result.granted, true);
    assert.equal(result.state.reason, "already-unlocked");
    assert.equal(runtime.state.open, false);
    assert.equal(calls.filter((entry) => entry.url.includes("/google-rewarded/current")).length, 1);
    assert.doesNotMatch(
      calls.find((entry) => entry.url.includes("/google-rewarded/current"))?.url || "",
      /surface=/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google rewarded runtime rejects when the current gate state is malformed", async () => {
  const originalFetch = globalThis.fetch;
  const { fetchStub } = createFetchStub({
    currentResponse: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha"
    }
  });
  globalThis.fetch = fetchStub;

  try {
    const runtime = createGoogleRewardedRuntime();
    await assert.rejects(
      () => runtime.requireUnlock({
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      }),
      /invalid state/i
    );
    assert.equal(runtime.state.open, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google rewarded runtime rejects reasonless non-blocking gate states", async () => {
  const originalFetch = globalThis.fetch;
  const { fetchStub } = createFetchStub({
    currentResponse: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha",
      enabled: false,
      blocked: false
    }
  });
  globalThis.fetch = fetchStub;

  try {
    const runtime = createGoogleRewardedRuntime();
    await assert.rejects(
      () => runtime.requireUnlock({
        gateKey: "progress-logging",
        workspaceSlug: "alpha"
      }),
      /invalid state/i
    );
    assert.equal(runtime.state.open, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google rewarded runtime completes a rewarded watch flow and grants unlock state", async () => {
  const globals = installBrowserGlobals({
    mode: "grant"
  });
  const { calls, fetchStub } = createFetchStub({
    currentResponse: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha",
      surface: "app",
      enabled: true,
      available: true,
      blocked: true,
      reason: "reward-required",
      rule: null,
      providerConfig: {
        id: "21",
        surface: "app",
        enabled: true,
        adUnitPath: "/123456/rewarded",
        scriptMode: "gpt_rewarded"
      },
      unlock: null,
      cooldownUntil: null,
      dailyLimitRemaining: null
    },
    startResponse: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha",
      surface: "app",
      enabled: true,
      available: true,
      blocked: true,
      reason: "reward-required",
      rule: null,
      providerConfig: {
        id: "21",
        surface: "app",
        enabled: true,
        adUnitPath: "/123456/rewarded",
        scriptMode: "gpt_rewarded"
      },
      unlock: null,
      cooldownUntil: null,
      dailyLimitRemaining: null,
      session: {
        id: "41",
        gateKey: "progress-logging",
        providerConfigId: "21",
        status: "started",
        startedAt: new Date().toISOString(),
        rewardedAt: null,
        completedAt: null,
        closedAt: null
      }
    },
    grantResponse: {
      unlocked: true,
      workspaceSlug: "alpha",
      gateKey: "progress-logging",
      unlock: {
        id: "51",
        gateKey: "progress-logging",
        providerConfigId: "21",
        watchSessionId: "41",
        grantedAt: new Date().toISOString(),
        unlockedUntil: new Date(Date.now() + 30 * 60_000).toISOString()
      },
      session: {
        id: "41",
        gateKey: "progress-logging",
        providerConfigId: "21",
        status: "rewarded",
        startedAt: new Date().toISOString(),
        rewardedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        closedAt: null
      }
    }
  });
  globalThis.fetch = fetchStub;

  try {
    const runtime = createGoogleRewardedRuntime();
    const unlockPromise = runtime.requireUnlock({
      gateKey: "progress-logging",
      workspaceSlug: "alpha"
    });

    await waitForAsyncTurn();
    assert.equal(runtime.state.phase, "prompt");

    await runtime.beginWatch();
    const result = await unlockPromise;

    assert.equal(result.granted, true);
    assert.equal(result.state.unlock.watchSessionId, "41");
    assert.equal(runtime.state.open, false);
    assert.equal(calls.filter((entry) => entry.url.includes("/google-rewarded/start")).length, 1);
    assert.equal(calls.filter((entry) => entry.url.includes("/google-rewarded/grant")).length, 1);
    assert.equal(calls.filter((entry) => entry.url.includes("/google-rewarded/close")).length, 0);
    assert.deepEqual(calls.find((entry) => entry.url.includes("/google-rewarded/start"))?.body, {
      gateKey: "progress-logging"
    });
  } finally {
    globals.restore();
  }
});

test("google rewarded runtime closes a started session when the ad is dismissed without reward", async () => {
  const globals = installBrowserGlobals({
    mode: "close"
  });
  const { calls, fetchStub } = createFetchStub({
    currentResponse: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha",
      surface: "app",
      enabled: true,
      available: true,
      blocked: true,
      reason: "reward-required",
      rule: null,
      providerConfig: {
        id: "21",
        surface: "app",
        enabled: true,
        adUnitPath: "/123456/rewarded",
        scriptMode: "gpt_rewarded"
      },
      unlock: null,
      cooldownUntil: null,
      dailyLimitRemaining: null
    },
    startResponse: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha",
      surface: "app",
      enabled: true,
      available: true,
      blocked: true,
      reason: "reward-required",
      rule: null,
      providerConfig: {
        id: "21",
        surface: "app",
        enabled: true,
        adUnitPath: "/123456/rewarded",
        scriptMode: "gpt_rewarded"
      },
      unlock: null,
      cooldownUntil: null,
      dailyLimitRemaining: null,
      session: {
        id: "41",
        gateKey: "progress-logging",
        providerConfigId: "21",
        status: "started",
        startedAt: new Date().toISOString(),
        rewardedAt: null,
        completedAt: null,
        closedAt: null
      }
    },
    closeResponse: {
      closed: true,
      workspaceSlug: "alpha",
      gateKey: "progress-logging",
      session: {
        id: "41",
        gateKey: "progress-logging",
        providerConfigId: "21",
        status: "closed",
        startedAt: new Date().toISOString(),
        rewardedAt: null,
        completedAt: null,
        closedAt: new Date().toISOString()
      },
      reason: null
    }
  });
  globalThis.fetch = fetchStub;

  try {
    const runtime = createGoogleRewardedRuntime();
    const unlockPromise = runtime.requireUnlock({
      gateKey: "progress-logging",
      workspaceSlug: "alpha"
    });

    await waitForAsyncTurn();
    await runtime.beginWatch();
    const result = await unlockPromise;

    assert.equal(result.granted, false);
    assert.equal(result.state.closed, true);
    assert.equal(runtime.state.open, false);
    assert.equal(calls.filter((entry) => entry.url.includes("/google-rewarded/grant")).length, 0);
    assert.equal(calls.filter((entry) => entry.url.includes("/google-rewarded/close")).length, 1);
  } finally {
    globals.restore();
  }
});

test("google rewarded runtime exposes an error state when no rewarded slot is available and cleans up on dismiss", async () => {
  const globals = installBrowserGlobals({
    mode: "unavailable"
  });
  const { calls, fetchStub } = createFetchStub({
    currentResponse: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha",
      surface: "app",
      enabled: true,
      available: true,
      blocked: true,
      reason: "reward-required",
      rule: null,
      providerConfig: {
        id: "21",
        surface: "app",
        enabled: true,
        adUnitPath: "/123456/rewarded",
        scriptMode: "gpt_rewarded"
      },
      unlock: null,
      cooldownUntil: null,
      dailyLimitRemaining: null
    },
    startResponse: {
      gateKey: "progress-logging",
      workspaceSlug: "alpha",
      surface: "app",
      enabled: true,
      available: true,
      blocked: true,
      reason: "reward-required",
      rule: null,
      providerConfig: {
        id: "21",
        surface: "app",
        enabled: true,
        adUnitPath: "/123456/rewarded",
        scriptMode: "gpt_rewarded"
      },
      unlock: null,
      cooldownUntil: null,
      dailyLimitRemaining: null,
      session: {
        id: "41",
        gateKey: "progress-logging",
        providerConfigId: "21",
        status: "started",
        startedAt: new Date().toISOString(),
        rewardedAt: null,
        completedAt: null,
        closedAt: null
      }
    },
    closeResponse: {
      closed: true,
      workspaceSlug: "alpha",
      gateKey: "progress-logging",
      session: {
        id: "41",
        gateKey: "progress-logging",
        providerConfigId: "21",
        status: "closed",
        startedAt: new Date().toISOString(),
        rewardedAt: null,
        completedAt: null,
        closedAt: new Date().toISOString()
      },
      reason: null
    }
  });
  globalThis.fetch = fetchStub;

  try {
    const runtime = createGoogleRewardedRuntime();
    const unlockPromise = runtime.requireUnlock({
      gateKey: "progress-logging",
      workspaceSlug: "alpha"
    });

    await waitForAsyncTurn();
    await runtime.beginWatch();

    assert.equal(runtime.state.phase, "error");
    assert.match(runtime.state.errorMessage, /rewarded ad/i);

    await runtime.dismissError();
    const result = await unlockPromise;

    assert.equal(result.granted, false);
    assert.equal(runtime.state.open, false);
    assert.equal(calls.filter((entry) => entry.url.includes("/google-rewarded/close")).length, 1);
  } finally {
    globals.restore();
  }
});
